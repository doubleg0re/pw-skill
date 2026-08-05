// sequence-engine.ts — runtime engine for the sequence flow.
//
// Extracted from sequence.ts as part of the Phase 2 refactor
// (.claude/docs/sequence-refactor.md). Behavior is intentionally unchanged —
// this file is `runSteps` and its helpers moved out of sequence.ts so the
// CLI entrypoint stays thin and testable.
//
// Public surface (re-exported by sequence.ts for backwards compatibility):
//   - VarStore            — variable store with $ref / $literal resolution
//   - evaluateCondition() — condition AST evaluation
//   - executeAction()     — single-action dispatcher (interpolate + call)
//   - runSteps()          — the flow engine proper
//   - DialogState, RunOptions — shapes used by the engine API
//
// Recursive `runSteps()` calls stay internal to this module.

import { existsSync, readFileSync } from 'fs';
import type { Page } from 'playwright';
import { ACTION_MAP } from './actions.js';
import { isSafeMode } from './safe-mode.js';
import { screenshotPath } from './common.js';
import type {
  ConditionNode,
  LeafCondition,
  Step,
  StepResult,
  DefEntry,
  SubflowInfo,
} from './sequence-types.js';

// --- Condition evaluator ---

export function evaluateCondition(node: ConditionNode, vars: VarStore): boolean {
  // Composite: and/or
  if ('and' in node && node.and) {
    return node.and.every(child => evaluateCondition(child, vars));
  }
  if ('or' in node && node.or) {
    return node.or.some(child => evaluateCondition(child, vars));
  }

  // Leaf
  const leaf = node as LeafCondition;
  if (!leaf.ref) return false;
  const refValue = vars.get(vars.interpolate(leaf.ref));
  const resolve = (v: any) => typeof v === 'string' ? vars.interpolate(v) : v;

  if ('eq' in leaf) return refValue == resolve(leaf.eq);
  if ('neq' in leaf) return refValue != resolve(leaf.neq);
  if ('gt' in leaf) return Number(refValue) > Number(resolve(leaf.gt));
  if ('lt' in leaf) return Number(refValue) < Number(resolve(leaf.lt));
  if ('contains' in leaf) return String(refValue ?? '').includes(String(resolve(leaf.contains)));
  if ('exists' in leaf) return leaf.exists ? refValue != null : refValue == null;

  return false;
}

const MAX_JUMPS = 100;

// --- Variable store ---

export class VarStore {
  private vars: Record<string, any> = {};

  set(name: string, value: any): void {
    this.vars[name] = value;
  }

  get(path: string): any {
    const parts = path.split('.');
    let current: any = this.vars;
    for (const part of parts) {
      if (current == null) return undefined;
      if (Array.isArray(current) && /^\d+$/.test(part)) {
        current = current[parseInt(part)];
      } else {
        current = current[part];
      }
    }
    return current;
  }

  /** Replace {{var.path}} templates with actual values. If the whole string is a template, returns original type. */
  interpolate(val: any): any {
    if (typeof val !== 'string') return val;

    // Check if the entire string is a single {{variable}}
    const singleMatch = val.match(/^\{\{([^}]+)\}\}$/);
    if (singleMatch) {
      return this.get(singleMatch[1].trim());
    }

    return val.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const value = this.get(path.trim());
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /**
   * Resolve a value recursively:
   * - string → interpolate {{}}
   * - { "$ref": "path" } → resolve to variable value (type preserved)
   * - { "$literal": ... } → unwrap and pass through as-is
   * - array → recurse each element
   * - plain object → recurse each value
   */
  private static MAX_RESOLVE_DEPTH = 20;
  private static MAX_RESOLVE_NODES = 500;

  resolveValue(val: any, depth: number = 0, state?: { nodeCount: number; visited: Set<any> }): any {
    const s = state || { nodeCount: 0, visited: new Set() };

    if (depth > VarStore.MAX_RESOLVE_DEPTH) throw new Error('$ref resolution depth exceeded (max 20)');
    if (s.nodeCount > VarStore.MAX_RESOLVE_NODES) throw new Error('$ref resolution node count exceeded (max 500)');
    s.nodeCount++;

    // String → interpolate
    if (typeof val === 'string') return this.interpolate(val);

    // Null/undefined/primitive
    if (val === null || val === undefined || typeof val !== 'object') return val;

    // Cycle detection
    if (s.visited.has(val)) throw new Error('$ref resolution cycle detected');
    s.visited.add(val);

    // $literal → unwrap
    if ('$literal' in val && Object.keys(val).length === 1) {
      return val.$literal;
    }

    // $ref → resolve
    if ('$ref' in val && Object.keys(val).length === 1) {
      return this.get(val.$ref);
    }

    // Array → recurse
    if (Array.isArray(val)) {
      return val.map(item => this.resolveValue(item, depth + 1, s));
    }

    // Object → recurse values
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      result[k] = this.resolveValue(v, depth + 1, s);
    }
    return result;
  }

  /** Interpolate/resolve the entire args array or object */
  interpolateArgs(args: string[] | Record<string, any>): any {
    if (Array.isArray(args)) {
      return args.map(a => this.resolveValue(a));
    }
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      result[k] = this.resolveValue(v);
    }
    return result;
  }

  snapshot(): Record<string, any> {
    return { ...this.vars };
  }
}

// --- Action executor ---

export async function executeAction(
  page: Page,
  action: string,
  rawArgs: string[] | Record<string, any>,
  vars: VarStore,
  runtimeActionMap?: Record<string, (page: any, args: any, runtime?: any) => Promise<{ result?: any }>>,
  runtime?: any,
): Promise<{ result?: any }> {
  const a = vars.interpolateArgs(rawArgs);
  const map = runtimeActionMap || ACTION_MAP;
  const fn = map[action] as (page: Page, a: any, runtime?: any) => Promise<{ result?: any }>;
  if (!fn) throw new Error(`Unknown action: ${action}`);

  // Extension actions receive runtime as 3rd arg. Built-in actions ignore it.
  return fn(page, a, runtime);
}

// --- Flow engine ---

export interface DialogState {
  pending: import('playwright').Dialog | null;
  log: Array<{ type: string; message: string }>;
  interruptedAction?: Promise<{ result?: any }>;
  interruptedStep?: { out?: string; action?: string; stepIndex?: number };
}

export interface RunOptions {
  allowShell?: boolean;
  requestPermission?: boolean;
  debugLog?: boolean;
  baseDir?: string;
  callDepth?: number;
  callStack?: string[];
  actionMap?: Record<string, (page: any, args: any, runtime?: any) => Promise<{ result?: any }>>;
  runtime?: any; // ExtensionRuntimeContext for extension actions
  inSubflow?: boolean;
  dialogState?: DialogState;
}

async function postActionBookkeeping(action: string, result: any, page: Page, options: RunOptions): Promise<void> {
  // Emit core tab events after relevant actions
  if (options.runtime?.emitEvent) {
    if (action === 'navigate' || action === 'nav') {
      const { resolveTab, updateTab, assignTabId, buildTabEvent, TAB_EVENTS } = await import('./tab-registry.js');
      const pageIndex = page.context().pages().indexOf(page);
      let navTab = resolveTab(result?.url, pageIndex >= 0 ? pageIndex : undefined);
      if (navTab) {
        updateTab(navTab.tabId, { url: result?.url, title: result?.title });
      } else {
        navTab = assignTabId(result?.url, result?.title, pageIndex >= 0 ? pageIndex : undefined);
      }
      options.runtime.emitEvent(TAB_EVENTS.NAVIGATED, buildTabEvent(TAB_EVENTS.NAVIGATED, options.runtime.session.name, navTab));
    }
  }

  // Advance documentEpoch after navigation/reload actions
  if (['navigate', 'nav', 'refresh', 'reload'].includes(action) && options.runtime?.session?.name) {
    const { advanceDocumentEpoch } = await import('./session.js');
    advanceDocumentEpoch(options.runtime.session.name);
  }
}

export async function runSteps(
  page: Page,
  steps: Step[],
  vars: VarStore,
  results: StepResult[],
  defs: Map<string, DefEntry>,
  baseIndex: number = 0,
  options: RunOptions = {},
): Promise<{ success: boolean; failedAt?: number; goto?: string; returnValue?: any; pendingDialog?: { type: string; message: string } }> {
  // --- Dialog state: shared across nested runSteps calls ---
  const dialogState: DialogState = options.dialogState || { pending: null, log: [] };
  if (!options.dialogState && typeof page.on === 'function') {
    // Top-level call with real Playwright page: register dialog listener
    // Mark context so common.ts handler defers to us
    try { (page.context() as any).__pwDialogState = true; } catch {}
    page.on('dialog', d => {
      dialogState.pending = d;
      dialogState.log.push({ type: d.type(), message: d.message() });
      // Auto-dismiss beforeunload to prevent navigation blocking
      if (d.type() === 'beforeunload') {
        d.accept().catch(() => {});
        dialogState.pending = null;
      }
    });
    options = { ...options, dialogState };
  }

  // Debug log helper
  const debugLog = options.debugLog
    ? (stepIdx: number, action: string, status: string, detail?: string) => {
        process.stderr.write(`[${stepIdx}] ${action} ${status}${detail ? ' ' + detail : ''}\n`);
      }
    : undefined;

  // Build label → index map
  const labelMap = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].label) {
      labelMap.set(steps[i].label!, i);
    }
  }

  let jumpCount = 0;
  let i = 0;

  while (i < steps.length) {
    const step = steps[i];
    const stepIndex = baseIndex + i;

    try {
      // --- label (pure marker with no action) ---
      if (!step.action) {
        i++;
        continue;
      }

      // --- try / catch / finally ---
      if (step.action === 'try') {
        const tryBody = step.items || [];
        const finallyBody = step.finally || [];
        let trySub = await runSteps(page, tryBody, vars, results, defs, stepIndex * 1000, options);

        if (!trySub.success) {
          // Classify error
          const lastError = results[results.length - 1]?.error || '';
          let errorType = 'error';
          if (/challenge/i.test(lastError)) errorType = 'challenge';
          else if (/not found|no element|locator/i.test(lastError)) errorType = 'notfound';
          else if (/timeout/i.test(lastError)) errorType = 'timeout';

          vars.set('$error', lastError);
          vars.set('$errorType', errorType);

          // Find matching catch handler
          let catchBody: Step[] | undefined;

          // 1. Try catch:<type> (e.g., catch:timeout)
          const typedCatchKey = `catch:${errorType}`;
          if ((step as any)[typedCatchKey]) {
            catchBody = (step as any)[typedCatchKey];
          }

          // 2. Try named condition defs as catch:<defName>
          if (!catchBody) {
            for (const key of Object.keys(step)) {
              if (key.startsWith('catch:') && key !== typedCatchKey) {
                const condName = key.slice(6);
                const condDef = defs.get(condName);
                if (condDef?.kind === 'condition' && evaluateCondition(condDef.condition, vars)) {
                  catchBody = (step as any)[key];
                  errorType = condName;
                  break;
                }
              }
            }
          }

          // 3. Generic catch
          if (!catchBody && step.catch) {
            catchBody = step.catch;
          }

          results.push({ step: stepIndex, action: 'try', success: true, data: { caught: !!catchBody, errorType } });

          if (catchBody) {
            const catchSub = await runSteps(page, catchBody, vars, results, defs, stepIndex * 2000, options);
            if (catchSub.goto) {
              // Run finally before goto
              if (finallyBody.length > 0) {
                await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000, options);
              }
              if (labelMap.has(catchSub.goto)) {
                if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
                i = labelMap.get(catchSub.goto)!;
                continue;
              }
              return catchSub;
            }
          } else {
            // No catch matched — run finally then fail
            if (finallyBody.length > 0) {
              await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000, options);
            }
            return { success: false, failedAt: stepIndex };
          }
        } else {
          results.push({ step: stepIndex, action: 'try', success: true, data: { caught: false } });

          // Handle goto from try body
          if (trySub.goto) {
            if (finallyBody.length > 0) {
              await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000, options);
            }
            if (labelMap.has(trySub.goto)) {
              if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
              i = labelMap.get(trySub.goto)!;
              continue;
            }
            return trySub;
          }
        }

        // Always run finally
        if (finallyBody.length > 0) {
          await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000, options);
        }

        i++;
        continue;
      }

      // --- def (func, condition, or flow) ---
      if (step.action === 'def') {
        const defType = step.type || 'func';
        if (defType === 'condition') {
          const condItems = (step.items || []) as ConditionNode[];
          const condition: ConditionNode = condItems.length === 1 ? condItems[0] : { or: condItems };
          defs.set(step.name!, { kind: 'condition', condition });
        } else if (defType === 'flow') {
          // Load external subflow file
          const flowPath = step.path;
          if (!flowPath) {
            results.push({ step: stepIndex, action: 'def', success: false, error: `def type="flow" requires "path"` });
            return { success: false, failedAt: stepIndex };
          }
          const { resolve, dirname } = await import('path');
          const absPath = options.baseDir ? resolve(options.baseDir, flowPath) : resolve(flowPath);
          if (!existsSync(absPath)) {
            results.push({ step: stepIndex, action: 'def', success: false, error: `Subflow file not found: ${absPath}` });
            return { success: false, failedAt: stepIndex };
          }
          const raw = JSON.parse(readFileSync(absPath, 'utf-8'));
          if (!raw || typeof raw !== 'object' || !Array.isArray(raw.flow)) {
            results.push({ step: stepIndex, action: 'def', success: false, error: `Subflow file must be { info: { type: "subflow" }, flow: [...] }` });
            return { success: false, failedAt: stepIndex };
          }
          const subInfo: SubflowInfo = raw.info || {};
          if (subInfo.type !== 'subflow') {
            results.push({ step: stepIndex, action: 'def', success: false, error: `Subflow info.type must be "subflow"` });
            return { success: false, failedAt: stepIndex };
          }
          // Validate param contract: if both def.params and subflow info.parameters exist, they must match
          if (step.params && subInfo.parameters) {
            const defP = JSON.stringify(step.params.sort());
            const subP = JSON.stringify([...subInfo.parameters].sort());
            if (defP !== subP) {
              results.push({ step: stepIndex, action: 'def', success: false, error: `Parameter mismatch: def.params=${JSON.stringify(step.params)} vs subflow.parameters=${JSON.stringify(subInfo.parameters)}` });
              return { success: false, failedAt: stepIndex };
            }
          }
          defs.set(step.name!, { kind: 'flow', params: step.params || subInfo.parameters || [], path: absPath, steps: raw.flow, info: subInfo });
        } else {
          // func: items is Step[]
          defs.set(step.name!, { kind: 'block', params: step.params || [], body: (step.items || []) as Step[] });
        }
        results.push({ step: stepIndex, action: 'def', success: true, data: { name: step.name, type: defType } });
        i++;
        continue;
      }

      // --- call (func only — condition defs are used via try catch:<name>) ---
      if (step.action === 'call') {
        const def = defs.get(step.name!);
        if (!def) {
          results.push({ step: stepIndex, action: 'call', success: false, error: `"${step.name}" is not defined` });
          return { success: false, failedAt: stepIndex };
        }

        if (def.kind === 'condition') {
          results.push({ step: stepIndex, action: 'call', success: false, error: `"${step.name}" is a condition def, not a func. Use it in try catch:${step.name} instead.` });
          return { success: false, failedAt: stepIndex };
        }

        // Determine body and params
        const callBody = def.kind === 'flow' ? def.steps : def.body;
        const callParams = def.params;

        // Inject args
        if (step.args) {
          if (Array.isArray(step.args)) {
            callParams.forEach((p, idx) => {
              const v = (step.args as string[])[idx];
              vars.set(p, typeof v === 'string' ? vars.interpolate(v) : v);
            });
          } else {
            for (const [k, v] of Object.entries(step.args)) {
              vars.set(k, typeof v === 'string' ? vars.interpolate(v) : v);
            }
          }
        }
        results.push({ step: stepIndex, action: 'call', success: true, data: { name: step.name, kind: def.kind } });

        // For flow calls: set baseDir to subflow's directory, track call depth/stack
        const callOptions = def.kind === 'flow'
          ? {
              ...options,
              baseDir: (await import('path')).dirname(def.path),
              callDepth: (options.callDepth || 0) + 1,
              callStack: [...(options.callStack || []), step.name!],
              inSubflow: true,
            }
          : options;

        // Call depth protection
        const MAX_CALL_DEPTH = 20;
        if ((callOptions.callDepth || 0) > MAX_CALL_DEPTH) {
          results.push({ step: stepIndex, action: 'call', success: false, error: `Max call depth (${MAX_CALL_DEPTH}) exceeded` });
          return { success: false, failedAt: stepIndex };
        }

        // Cycle detection
        if (def.kind === 'flow' && (options.callStack || []).includes(step.name!)) {
          const chain = [...(options.callStack || []), step.name!].join(' -> ');
          results.push({ step: stepIndex, action: 'call', success: false, error: `Subflow cycle detected: ${chain}` });
          return { success: false, failedAt: stepIndex };
        }

        const sub = await runSteps(page, callBody, vars, results, defs, stepIndex * 1000, callOptions);
        if (!sub.success) return sub;

        // Capture return value (flow) or last step data (func)
        // Option B: $ret and out are always symmetric
        const callResult = sub.returnValue !== undefined
          ? sub.returnValue
          : results[results.length - 1]?.data;
        if (step.out) vars.set(step.out, callResult);
        vars.set('$ret', callResult);
        if (sub.goto) {
          if (labelMap.has(sub.goto)) {
            if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
            i = labelMap.get(sub.goto)!;
            continue;
          }
          return sub;
        }
        i++;
        continue;
      }

      // --- goto ---
      if (step.action === 'goto') {
        const target = vars.interpolate(step.label!);
        if (labelMap.has(target)) {
          if (++jumpCount > MAX_JUMPS) {
            results.push({ step: stepIndex, action: 'goto', success: false, error: `Max jumps (${MAX_JUMPS}) exceeded` });
            return { success: false, failedAt: stepIndex };
          }
          results.push({ step: stepIndex, action: 'goto', success: true, data: { label: target } });
          i = labelMap.get(target)!;
          continue;
        }
        // Not in current scope, bubble up to parent
        results.push({ step: stepIndex, action: 'goto', success: true, data: { label: target, bubble: true } });
        return { success: true, goto: target };
      }

      // --- log ---
      if (step.action === 'log') {
        let value: any;
        if (step.text) {
          value = vars.interpolate(step.text);
        } else if (step.ref) {
          value = vars.get(vars.interpolate(step.ref));
        } else {
          value = vars.snapshot();
        }
        results.push({ step: stepIndex, action: 'log', success: true, data: value });
        i++;
        continue;
      }

      // --- condition ---
      if (step.action === 'condition') {
        let matched: boolean;
        let condData: any;

        if (step.and || step.or) {
          // Composite condition (and/or)
          const node: ConditionNode = step.and ? { and: step.and } : { or: step.or! };
          matched = evaluateCondition(node, vars);
          condData = { composite: true, matched };
        } else {
          // Leaf condition (backward compat)
          const leaf: LeafCondition = { ref: step.ref!, ...(('eq' in step) ? { eq: step.eq } : {}), ...(('neq' in step) ? { neq: step.neq } : {}), ...(('gt' in step) ? { gt: step.gt } : {}), ...(('lt' in step) ? { lt: step.lt } : {}), ...(('contains' in step) ? { contains: step.contains } : {}), ...(('exists' in step) ? { exists: step.exists } : {}) };
          matched = evaluateCondition(leaf, vars);
          condData = { ref: step.ref, value: vars.get(vars.interpolate(step.ref!)), matched };
        }

        const branch = matched ? step.then : step.else;
        results.push({ step: stepIndex, action: 'condition', success: true, data: condData });

        if (branch && branch.length > 0) {
          const sub = await runSteps(page, branch, vars, results, defs, stepIndex * 1000, options);
          if (!sub.success) return sub;
          // Handle goto bubbling
          if (sub.goto) {
            if (labelMap.has(sub.goto)) {
              if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
              i = labelMap.get(sub.goto)!;
              continue;
            }
            return sub; // Continue bubbling up
          }
        }
        i++;
        continue;
      }

      // --- each ---
      if (step.action === 'each') {
        const target = vars.get(vars.interpolate(step.ref!));
        const body = step.items || [];

        if (target == null) {
          results.push({ step: stepIndex, action: 'each', success: false, error: `ref "${step.ref}" is null/undefined` });
          return { success: false, failedAt: stepIndex };
        }

        const asRaw = step.as || 'item';
        const destructureMatch = asRaw.match(/^\{(\w+),\s*(\w+)\}$/);
        const keyVar = destructureMatch ? destructureMatch[1] : null;
        const valueVar = destructureMatch ? destructureMatch[2] : asRaw;

        const isArray = Array.isArray(target);
        const entries = isArray
          ? target.map((v: any, idx: number) => ({ key: null, value: v, index: idx }))
          : Object.entries(target).map(([k, v], idx) => ({ key: k, value: v, index: idx }));

        results.push({ step: stepIndex, action: 'each', success: true, data: { type: isArray ? 'array' : 'object', length: entries.length } });

        let eachGoto = false;
        for (const entry of entries) {
          vars.set(valueVar, entry.value);
          if (keyVar) vars.set(keyVar, entry.key);
          vars.set('$index', entry.index);
          vars.set('$key', entry.key);

          const sub = await runSteps(page, body, vars, results, defs, (stepIndex * 1000) + (entry.index * 100), options);
          if (!sub.success) return sub;
          if (sub.goto) {
            if (labelMap.has(sub.goto)) {
              if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
              i = labelMap.get(sub.goto)!;
              eachGoto = true;
              break;
            }
            return sub;
          }
        }
        if (eachGoto) continue;
        i++;
        continue;
      }

      // --- loop (condition-based, replaces count) ---
      if (step.action === 'loop') {
        const body = step.items || [];
        const loopCondition = step.condition;
        // Backward compat: count → condition { ref: "$index", lt: count }
        const condNode: ConditionNode | null = loopCondition
          ? (loopCondition as ConditionNode)
          : (step.count !== undefined ? { ref: '$index', lt: step.count } : null);

        const maxIterations = MAX_JUMPS * 10; // safety cap
        let iteration = 0;

        results.push({ step: stepIndex, action: 'loop', success: true, data: { conditionBased: !!loopCondition } });

        let loopGoto = false;
        vars.set('$index', 0);

        while (iteration < maxIterations) {
          // Evaluate condition before each iteration
          if (condNode && !evaluateCondition(condNode, vars)) break;

          const sub = await runSteps(page, body, vars, results, defs, (stepIndex * 1000) + (iteration * 100), options);
          if (!sub.success) return sub;
          if (sub.goto) {
            if (labelMap.has(sub.goto)) {
              if (++jumpCount > MAX_JUMPS) return { success: false, failedAt: stepIndex };
              i = labelMap.get(sub.goto)!;
              loopGoto = true;
              break;
            }
            return sub;
          }

          iteration++;
          vars.set('$index', iteration);
        }
        if (loopGoto) continue;
        i++;
        continue;
      }

      // --- return (subflow only) ---
      if (step.action === 'return') {
        if (!options.inSubflow) {
          results.push({ step: stepIndex, action: 'return', success: false, error: 'return is only allowed inside def type="flow" subflows' });
          return { success: false, failedAt: stepIndex };
        }
        let returnValue: any = null;
        if (step.value) {
          if ('$ref' in step.value) {
            returnValue = vars.get(step.value.$ref);
          } else if ('ref' in step.value) {
            returnValue = vars.get(step.value.ref);
          } else if ('value' in step.value) {
            returnValue = step.value.value;
          } else {
            returnValue = vars.resolveValue(step.value);
          }
        }
        results.push({ step: stepIndex, action: 'return', success: true, data: returnValue });
        return { success: true, returnValue };
      }

      // --- set ---
      if (step.action === 'set') {
        const setItems = (step.items || {}) as Record<string, { ref?: string; value?: any }>;
        const setData: Record<string, any> = {};
        for (const [name, source] of Object.entries(setItems)) {
          if ('ref' in source) {
            setData[name] = vars.get(vars.interpolate(source.ref!));
          } else if ('value' in source) {
            setData[name] = source.value;
          }
          vars.set(name, setData[name]);
        }
        results.push({ step: stepIndex, action: 'set', success: true, data: setData });
        i++;
        continue;
      }

      // --- shell ---
      if (step.action === 'shell') {
        if (isSafeMode() || !options.allowShell) {
          const shellError = isSafeMode()
            ? 'shell is unavailable in safe mode (PW_SAFE).'
            : 'Sequence contains shell action. Re-run with --allow-shell to enable local command execution.';
          results.push({ step: stepIndex, action: 'shell', success: false, error: shellError });
          return { success: false, failedAt: stepIndex };
        }

        // Request user permission before shell execution
        if (options.requestPermission) {
          const cmdPreview = Array.isArray(step.args) ? step.args.join(' ') : JSON.stringify(step.args);
          try {
            const { actionWait } = await import('./actions.js');
            const waitResult = await actionWait(page, {
              target: 'user-action',
              prompt: `Shell command: ${cmdPreview}`,
              actions: ['approve', 'cancel'],
            });
            if (waitResult.result?.action === 'cancel') {
              results.push({ step: stepIndex, action: 'shell', success: false, error: 'User canceled shell execution' });
              return { success: false, failedAt: stepIndex };
            }
          } catch {
            results.push({ step: stepIndex, action: 'shell', success: false, error: 'Shell permission prompt failed (headless? use --headed with --request-permission)' });
            return { success: false, failedAt: stepIndex };
          }
        }

        const shellArgs = Array.isArray(step.args) ? step.args.map(String) : [];
        const shellTimeout = (typeof step.args === 'object' && !Array.isArray(step.args)) ? Number(step.args?.timeout || 30000) : 30000;

        if (typeof step.args === 'object' && !Array.isArray(step.args) && step.args?.command) {
          shellArgs.length = 0;
          shellArgs.push(...(step.args.command as string[]).map(String));
        }

        if (shellArgs.length === 0) {
          results.push({ step: stepIndex, action: 'shell', success: false, error: 'shell requires args (command array)' });
          return { success: false, failedAt: stepIndex };
        }

        const { spawnSync } = await import('child_process');
        const cmd = shellArgs[0];
        const cmdArgs = shellArgs.slice(1);
        const proc = spawnSync(cmd, cmdArgs, { timeout: shellTimeout, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

        const shellResult = {
          exitCode: proc.status ?? -1,
          stdout: (proc.stdout || '').trim(),
          stderr: (proc.stderr || '').trim(),
        };

        if (step.out) vars.set(step.out, shellResult);
        results.push({ step: stepIndex, action: 'shell', success: proc.status === 0, data: shellResult });

        if (proc.status !== 0) {
          return { success: false, failedAt: stepIndex };
        }

        i++;
        continue;
      }

      // --- dialog action (accept / dismiss / show) ---
      if (step.action === 'dialog') {
        // Build args same way as general actions: explicit args, or step's own fields as named args
        const rawDialogArgs = step.args !== undefined ? step.args : (() => {
          const { action, out, label, save, retry, comment, ...rest } = step as any;
          return Object.keys(rest).length > 0 ? rest : [];
        })();
        const dialogArgs = vars.interpolateArgs(rawDialogArgs);
        const subcommand = Array.isArray(dialogArgs) ? dialogArgs[0] : (dialogArgs as any)?.command || dialogArgs?.[0];
        const promptText = Array.isArray(dialogArgs) ? dialogArgs[1] : (dialogArgs as any)?.text;

        const { handleDialogStep } = await import('./chain-utils.js');
        const { data, cleared, error } = await handleDialogStep(dialogState.pending, subcommand, promptText);

        if (error) {
          results.push({ step: stepIndex, action: 'dialog', success: false, error });
          return { success: false, failedAt: stepIndex };
        }
        results.push({ step: stepIndex, action: 'dialog', success: true, data });
        if (cleared) dialogState.pending = null;
        // Await the interrupted action (with dialog re-race) and run normal success bookkeeping
        if (dialogState.interruptedAction) {
          const iStep = dialogState.interruptedStep;
          try {
            // Re-race against another dialog so we don't deadlock
            let cancelResumePoll = false;
            const resumeDialogPromise = new Promise<'dialog'>((resolve) => {
              const check = () => {
                if (cancelResumePoll) return;
                if (dialogState.pending) resolve('dialog');
                else setTimeout(check, 50);
              };
              setTimeout(check, 10);
            });
            const resumeRace = await Promise.race([
              dialogState.interruptedAction.then(
                r => { cancelResumePoll = true; return { kind: 'resolved' as const, ...r }; },
                err => { cancelResumePoll = true; throw err; },
              ),
              resumeDialogPromise.then(() => { cancelResumePoll = true; return { kind: 'dialog' as const, result: undefined }; }),
            ]);
            if (resumeRace.kind === 'dialog') {
              // Second dialog appeared — keep interruptedAction/Step so next dialog step can resume it
              i++;
              continue;
            }
            const { result: interruptedResult } = resumeRace;
            vars.set('$ret', interruptedResult);
            vars.set('$err', null);
            vars.set('$code', null);
            if (iStep?.out) vars.set(iStep.out, interruptedResult);
            // Record the resumed action result and run post-action bookkeeping
            results.push({
              step: iStep?.stepIndex ?? stepIndex,
              action: iStep?.action ?? 'unknown',
              success: true,
              ...(interruptedResult !== undefined ? { data: interruptedResult } : {}),
            });
            if (iStep?.action) {
              await postActionBookkeeping(iStep.action, interruptedResult, page, options);
            }
          } catch (actionErr) {
            const errMsg = actionErr instanceof Error ? actionErr.message : String(actionErr);
            results.push({
              step: iStep?.stepIndex ?? stepIndex,
              action: iStep?.action ?? 'unknown',
              success: false,
              error: `Interrupted action failed after dialog: ${errMsg}`,
            });
            dialogState.interruptedAction = undefined;
            dialogState.interruptedStep = undefined;
            return { success: false, failedAt: iStep?.stepIndex ?? stepIndex };
          }
          dialogState.interruptedAction = undefined;
          dialogState.interruptedStep = undefined;
        }
        i++;
        continue;
      }

      // --- General action ---
      debugLog?.(stepIndex, step.action!, 'start');
      // If step has no explicit args field, use step's own fields as named args
      // (e.g., { action: "wait", target: "user-action", prompt: "..." })
      const stepArgs = step.args !== undefined ? step.args : (() => {
        const { action, out, label, save, retry, comment, ...rest } = step as any;
        return Object.keys(rest).length > 0 ? rest : [];
      })();

      // Race action execution against dialog detection
      const actionPromise = executeAction(page, step.action!, stepArgs, vars, options.actionMap, options.runtime);
      let cancelPoll = false;
      const dialogPromise = new Promise<'dialog'>((resolve) => {
        const check = () => {
          if (cancelPoll) return;
          if (dialogState.pending) resolve('dialog');
          else setTimeout(check, 50);
        };
        setTimeout(check, 10);
      });

      const raceResult = await Promise.race([
        actionPromise.then(
          r => { cancelPoll = true; return { kind: 'action' as const, ...r }; },
          err => { cancelPoll = true; throw err; },
        ),
        dialogPromise.then(() => ({ kind: 'dialog' as const, result: undefined })),
      ]);

      if (raceResult.kind === 'dialog') {
        // Dialog appeared during action — find next meaningful step (skip labels/comments)
        let nextIdx = i + 1;
        while (nextIdx < steps.length && !steps[nextIdx].action) nextIdx++;
        const nextStep = steps[nextIdx];
        if (nextStep?.action === 'dialog') {
          // Record current step as interrupted but successful (action started)
          results.push({
            step: stepIndex, action: step.action!, success: true,
            data: { interrupted: true, dialogType: dialogState.pending?.type(), dialogMessage: dialogState.pending?.message() },
          });
          debugLog?.(stepIndex, step.action!, 'dialog-interrupted');
          // Store the pending action and step metadata so we can await it after dialog is handled
          dialogState.interruptedAction = actionPromise;
          dialogState.interruptedStep = { out: step.out, action: step.action!, stepIndex };
          i++;
          continue; // next iteration will handle the dialog step
        }

        // No dialog handler next — interrupt the chain
        const dlg = dialogState.pending!;
        results.push({
          step: stepIndex, action: step.action!, success: false,
          error: `Action interrupted by ${dlg.type()} dialog: "${dlg.message()}"`,
        });
        return {
          success: false,
          failedAt: stepIndex,
          pendingDialog: { type: dlg.type(), message: dlg.message() },
        };
      }

      const { result } = raceResult;

      // Set ephemeral registers
      vars.set('$ret', result);
      vars.set('$err', null);
      vars.set('$code', null);

      if (step.out) {
        vars.set(step.out, result);
      }

      results.push({ step: stepIndex, action: step.action!, success: true, ...(result !== undefined ? { data: result } : {}) });
      debugLog?.(stepIndex, step.action!, 'ok');

      await postActionBookkeeping(step.action!, result, page, options);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      debugLog?.(stepIndex, step.action || 'unknown', `failed (${errorMsg.slice(0, 60)})`);
      // Set ephemeral error registers
      vars.set('$ret', null);
      vars.set('$err', errorMsg);
      vars.set('$code', null);

      results.push({
        step: stepIndex,
        action: step.action || 'unknown',
        success: false,
        error: errorMsg,
      });
      const path = screenshotPath(`sequence-error-${Date.now()}`, options.runtime?.session);
      try { await page.screenshot({ path }); } catch {}
      return { success: false, failedAt: stepIndex };
    }
    i++;
  }
  return { success: true };
}
