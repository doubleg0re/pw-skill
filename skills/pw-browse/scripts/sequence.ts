// sequence.ts — JSON-based action sequence + flow control engine
// Usage:
//   pw sequence '[{"action":"navigate","args":["http://localhost:3000"]}]'
//   pw sequence ./scripts/playwright/login-flow.json
//
// Variable system:
//   "out": "varName"  → store step result as a variable
//   "{{varName}}"     → reference variable in args
//   "{{var.path}}"    → access nested properties (e.g., items.data.0.name)
//
// Flow control:
//   log       — print variable values (debugging/structure inspection)
//   condition — conditional branching (eq, neq, gt, lt, contains, exists)
//   each      — iterate over arrays/objects (array: $key=null, object: $key=property name)
//   loop      — repeat N times ({{$index}} available)
import { run, screenshotPath } from './common.js';
import { existsSync, readFileSync } from 'fs';
import type { Page } from 'playwright';
import { ACTION_MAP } from './actions.js';

// --- Types ---

// --- Condition AST ---

export interface LeafCondition {
  ref: string;
  eq?: any;
  neq?: any;
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
}

export interface CompositeCondition {
  and?: ConditionNode[];
  or?: ConditionNode[];
}

export type ConditionNode = LeafCondition | CompositeCondition;

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

// --- Step ---

interface Step {
  action?: string;
  args?: string[] | Record<string, any>;
  out?: string;
  // comment (no-op documentation)
  comment?: string;
  // label / goto
  label?: string;
  // def / call
  type?: 'func' | 'condition' | 'flow';
  name?: string;
  params?: string[];
  items?: Step[] | ConditionNode[];
  path?: string;
  // return
  value?: any;
  // log
  text?: string;
  // condition (leaf — backward compat)
  ref?: string;
  eq?: any;
  neq?: any;
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
  // condition (composite)
  and?: ConditionNode[];
  or?: ConditionNode[];
  then?: Step[];
  else?: Step[];
  // each
  as?: string;
  // loop
  count?: number; // backward compat — prefer condition
  condition?: ConditionNode;
  // try/catch/finally
  catch?: Step[];
  finally?: Step[];
  [key: `catch:${string}`]: Step[] | undefined;
  // wait user-action
  prompt?: string;
  actions?: string[];
}

const MAX_JUMPS = 100;

export interface SubflowInfo {
  type: 'subflow';
  parameters?: string[];
  returns?: string;
}

export type DefEntry =
  | { kind: 'block'; params: string[]; body: Step[] }
  | { kind: 'condition'; condition: ConditionNode }
  | { kind: 'flow'; params: string[]; path: string; steps: Step[]; info: SubflowInfo };

interface StepResult {
  step: number;
  action: string;
  success: boolean;
  data?: any;
  error?: string;
}

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
}

export async function runSteps(
  page: Page,
  steps: Step[],
  vars: VarStore,
  results: StepResult[],
  defs: Map<string, DefEntry>,
  baseIndex: number = 0,
  options: RunOptions = {},
): Promise<{ success: boolean; failedAt?: number; goto?: string; returnValue?: any }> {
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

          const sub = await runSteps(page, body, vars, results, defs, (stepIndex * 1000) + (entry.index * 100));
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

          const sub = await runSteps(page, body, vars, results, defs, (stepIndex * 1000) + (iteration * 100));
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
        if (!options.allowShell) {
          results.push({ step: stepIndex, action: 'shell', success: false, error: 'Sequence contains shell action. Re-run with --allow-shell to enable local command execution.' });
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

      // --- General action ---
      debugLog?.(stepIndex, step.action!, 'start');
      const { result } = await executeAction(page, step.action!, step.args || [], vars, options.actionMap, options.runtime);

      // Set ephemeral registers
      vars.set('$ret', result);
      vars.set('$err', null);
      vars.set('$code', null);

      if (step.out) {
        vars.set(step.out, result);
      }

      results.push({ step: stepIndex, action: step.action!, success: true, ...(result !== undefined ? { data: result } : {}) });
      debugLog?.(stepIndex, step.action!, 'ok');

      // Emit core tab events after relevant actions
      if (options.runtime?.emitEvent) {
        if (step.action === 'navigate') {
          const { findTabByPageIndex, findTabByUrl, updateTab, assignTabId, buildTabEvent, TAB_EVENTS } = await import('./tab-registry.js');
          // Find existing tab: prefer pageIndex (accurate), fall back to URL
          const pageIndex = page.context().pages().indexOf(page);
          let navTab = (pageIndex >= 0 ? findTabByPageIndex(pageIndex) : undefined) || findTabByUrl(result?.url);
          if (navTab) {
            updateTab(navTab.tabId, { url: result?.url, title: result?.title });
          } else {
            navTab = assignTabId(result?.url, result?.title, pageIndex >= 0 ? pageIndex : undefined);
          }
          options.runtime.emitEvent(TAB_EVENTS.NAVIGATED, buildTabEvent(TAB_EVENTS.NAVIGATED, options.runtime.session.name, navTab));
        }
      }
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

// --- Syntax validator ---

const KNOWN_ACTIONS = new Set([
  'navigate', 'nav', 'refresh', 'reload', 'click', 'dblclick', 'drag', 'fill', 'type', 'wait', 'hover',
  'scroll', 'select', 'sel', 'upload', 'attr', 'submit', 'fetch', 'screenshot', 'shot',
  'evaluate', 'eval', 'log', 'condition', 'each', 'loop', 'def', 'call', 'goto', 'try', 'shell', 'set', 'dump', 'return',
]);

export function validateSteps(steps: Step[], prefix: string = '', extraKnownActions?: Set<string>): string[] {
  const allKnown = extraKnownActions
    ? new Set([...KNOWN_ACTIONS, ...extraKnownActions])
    : KNOWN_ACTIONS;
  const errors: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const loc = `${prefix}Step ${i}`;

    // Label-only or comment-only step
    if (!step.action && step.label) continue;
    if (!step.action && step.comment) {
      // comment-only step — valid no-op
      continue;
    }
    if (!step.action && !step.label && !step.comment) {
      errors.push(`${loc}: step has no action, label, or comment`);
      continue;
    }

    const action = step.action!;

    // comment + action is invalid
    if (step.comment && step.action) {
      errors.push(`${loc}: step cannot have both "comment" and "action"`);
    }

    // Unknown action
    if (!allKnown.has(action)) {
      errors.push(`${loc}: unknown action "${action}"`);
    }

    // condition
    if (action === 'condition') {
      const hasLeaf = 'ref' in step;
      const hasComposite = 'and' in step || 'or' in step;
      if (hasLeaf && hasComposite) {
        errors.push(`${loc}: condition cannot mix "ref" with "and"/"or"`);
      }
      if ('and' in step && 'or' in step) {
        errors.push(`${loc}: condition cannot have both "and" and "or" at same level`);
      }
      if (hasLeaf && !step.ref) {
        errors.push(`${loc}: condition leaf requires "ref"`);
      }
    }

    // def
    if (action === 'def') {
      if (!step.name) errors.push(`${loc}: def requires "name"`);
      if (step.type && !['func', 'condition', 'flow'].includes(step.type)) {
        errors.push(`${loc}: def type must be "func", "condition", or "flow"`);
      }
      if (step.type === 'flow') {
        if (!step.path) errors.push(`${loc}: def type="flow" requires "path"`);
        if (step.items) errors.push(`${loc}: def type="flow" cannot have "items" (use "path")`);
      }
    }

    // return
    if (action === 'return') {
      if (!step.value) errors.push(`${loc}: return requires "value"`);
    }

    // call
    if (action === 'call') {
      if (!step.name) errors.push(`${loc}: call requires "name"`);
    }

    // each
    if (action === 'each') {
      if (!step.ref) errors.push(`${loc}: each requires "ref"`);
      if (!step.items) errors.push(`${loc}: each requires "items"`);
    }

    // loop
    if (action === 'loop') {
      if (step.count === undefined && !step.condition) {
        errors.push(`${loc}: loop requires "condition" or "count"`);
      }
      if (!step.items) errors.push(`${loc}: loop requires "items"`);
    }

    // try
    if (action === 'try') {
      const tryBody = step.items;
      if (!tryBody || !Array.isArray(tryBody)) {
        errors.push(`${loc}: try requires "items" array`);
      }
      if (step.finally && !Array.isArray(step.finally)) {
        errors.push(`${loc}: try "finally" must be an array`);
      }
    }

    // set
    if (action === 'set') {
      if (!step.items || typeof step.items !== 'object' || Array.isArray(step.items)) {
        errors.push(`${loc}: set requires "items" as object`);
      } else {
        for (const [name, source] of Object.entries(step.items as Record<string, any>)) {
          if (name.startsWith('$')) {
            errors.push(`${loc}: set destination "${name}" cannot start with "$"`);
          }
          if (source && 'ref' in source && 'value' in source) {
            errors.push(`${loc}: set item "${name}" must contain exactly one of "ref" or "value"`);
          }
          if (source && !('ref' in source) && !('value' in source)) {
            errors.push(`${loc}: set item "${name}" must contain "ref" or "value"`);
          }
        }
      }
    }

    // shell
    if (action === 'shell') {
      if (!step.args) errors.push(`${loc}: shell requires "args"`);
    }

    // wait
    if (action === 'wait') {
      if (step.actions) {
        if (!Array.isArray(step.actions) || step.actions.length === 0) {
          errors.push(`${loc}: wait "actions" must be a non-empty string array`);
        }
      }
      // observation wait requires trigger
      const tgt = step.args?.[0] || (step as any).target;
      if (typeof tgt === 'string' && (tgt.startsWith('dom:') || tgt.startsWith('url:') || tgt === 'challenge')) {
        // trigger recommended but not strictly required (could just wait for change)
      }
    }

    // goto
    if (action === 'goto') {
      if (!step.label) errors.push(`${loc}: goto requires "label"`);
    }

    // out cannot use $ prefix (reserved for built-in variables)
    if (step.out && step.out.startsWith('$')) {
      errors.push(`${loc}: "out" cannot start with "$" (reserved for built-in variables like $index, $error)`);
    }

    // Recurse into nested steps (skip condition def items — they're ConditionNode[], not Step[])
    if (step.items && !(step.action === 'def' && step.type === 'condition')) {
      errors.push(...validateSteps(step.items as Step[], `${loc}.items → `, extraKnownActions));
    }
    if (step.then) errors.push(...validateSteps(step.then, `${loc}.then → `, extraKnownActions));
    if (step.else) errors.push(...validateSteps(step.else, `${loc}.else → `, extraKnownActions));
    if (step.finally) errors.push(...validateSteps(step.finally as Step[], `${loc}.finally → `, extraKnownActions));
  }

  return errors;
}

// --- Step shorthand normalization (exported for testing) ---

// Keys that indicate an explicit step (not shorthand)
const EXPLICIT_STEP_KEYS = new Set([
  'action', 'comment', 'condition', 'each', 'loop', 'try', 'def', 'call',
  'shell', 'return', 'set', 'log',
]);

/**
 * Normalize a shorthand step into explicit form.
 *
 * Shorthand: { "navigate": "https://example.com" }
 *        or: { "fill": ["#email", "test@test.com"] }
 * Explicit:  { "action": "navigate", "args": ["https://example.com"] }
 *
 * Rules:
 * - Must be a single-key object (excluding "comment")
 * - Key must not be an explicit step key
 * - Value becomes args (wrapped in array if not already)
 * - Multi-key objects with shorthand + metadata are rejected
 */
export function normalizeStep(step: any): any {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step;

  // Already explicit form
  const keys = Object.keys(step);
  if (keys.some(k => EXPLICIT_STEP_KEYS.has(k))) return step;

  // Comment-only step
  if (keys.length === 1 && keys[0] === 'comment') return step;

  // Filter out comment key for shorthand detection
  const nonCommentKeys = keys.filter(k => k !== 'comment');

  if (nonCommentKeys.length === 0) return step;

  if (nonCommentKeys.length === 1) {
    const actionName = nonCommentKeys[0];
    const value = step[actionName];
    // Array → use as positional args
    // Plain object → use as named args (ActionArgs Record style)
    // Primitive → wrap as single-element array
    let args: any;
    if (Array.isArray(value)) {
      args = value;
    } else if (value !== null && typeof value === 'object') {
      args = value; // named object args — pass through as-is
    } else {
      args = [value]; // string, number, etc → positional
    }
    return { action: actionName, args };
  }

  // Multiple non-comment, non-explicit keys → ambiguous, reject
  // (could be shorthand + metadata, which is not allowed)
  return step;
}

// --- Params loading (exported for testing) ---

const FORBIDDEN_PARAM_KEYS = new Set([
  'action', 'def', 'call', 'condition', 'each', 'loop', 'try', 'catch',
  'finally', 'shell', 'return', 'flow', 'items', 'comment',
]);

/** Load params from JSON string or file path into VarStore. Returns error string or null. */
export function loadParams(vars: VarStore, paramsArg: string): string | null {
  let data: Record<string, any>;
  try {
    if (existsSync(paramsArg)) {
      data = JSON.parse(readFileSync(paramsArg, 'utf-8'));
    } else {
      data = JSON.parse(paramsArg);
    }
  } catch {
    return `Invalid --params: not valid JSON or file not found.`;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return `--params must be a JSON object, not ${Array.isArray(data) ? 'array' : typeof data}.`;
  }

  // Check forbidden keys
  const forbidden = Object.keys(data).filter(k => FORBIDDEN_PARAM_KEYS.has(k));
  if (forbidden.length > 0) {
    return `--params contains forbidden keys: ${forbidden.join(', ')}. Params are data-only.`;
  }

  // Load referenced param files ($id and load are metadata, skip them)
  for (const [key, value] of Object.entries(data)) {
    if (key === '$id' || key === 'load') continue;
    vars.set(key, value);
  }

  // Handle "load" — merge additional param files
  if (Array.isArray(data.load)) {
    for (const loadPath of data.load) {
      if (typeof loadPath !== 'string') continue;
      const subError = loadParams(vars, loadPath);
      if (subError) return subError;
    }
  }

  return null;
}

// --- requiresRary validation (exported for testing) ---

export function validateRequiresRary(
  info: any,
  cliRary: string[],
  activeExtensions: Set<string>,
  installedExtensions?: Set<string>,
): string | null {
  // Format validation
  if (info?.requiresRary !== undefined) {
    if (!Array.isArray(info.requiresRary) || !info.requiresRary.every((r: any) => typeof r === 'string' && r.length > 0)) {
      return 'info.requiresRary must be an array of non-empty strings.';
    }
  }

  const required: string[] = [
    ...(Array.isArray(info?.requiresRary) ? info.requiresRary : []),
    ...cliRary,
  ];

  if (required.length === 0) return null;

  const missing = required.filter(name => !activeExtensions.has(name));
  if (missing.length === 0) return null;

  // Distinguish installed-but-inactive from not-installed
  const details = missing.map(name => {
    if (installedExtensions?.has(name)) {
      return `"${name}" (installed but not active — run \`pw rary put ${name}\`)`;
    }
    return `"${name}" (not installed — run \`pw rary get <repo> && pw rary put ${name}\`)`;
  });

  return `Flow requires rary extension(s): ${details.join(', ')}`;
}

// --- Entry point (only when run directly, not when imported) ---

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('/sequence.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/sequence.js');

if (isDirectRun) run(async ({ page, args: cliArgs, session }) => {
  const input = cliArgs[0];
  if (!input) return { success: false, error: 'Usage: sequence.ts <json-string | json-file-path>' };

  const allowShell = process.argv.includes('--allow-shell');
  const requestPermission = process.argv.includes('--request-permission');
  const debugLog = process.argv.includes('--debug-log');

  // Heartbeat lock for long-running sequences
  const { acquireLock, releaseLock, refreshLock } = await import('./lock.js');
  const { join } = await import('path');
  const lockPath = join(process.cwd(), '.playwright-state', '.sequence.lock');
  acquireLock(lockPath, 'sequence');
  const heartbeat = setInterval(() => refreshLock(lockPath), 30000);

  let steps: Step[];
  let info: any = undefined;
  try {
    const raw = existsSync(input)
      ? JSON.parse(readFileSync(input, 'utf-8'))
      : JSON.parse(input);

    if (Array.isArray(raw)) {
      steps = raw;
    } else if (raw && typeof raw === 'object' && Array.isArray(raw.flow)) {
      steps = raw.flow;
      info = raw.info || undefined;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      // Single-step root object → wrap as [step]
      steps = [raw];
    } else {
      return { success: false, error: 'JSON must be an array of steps, an object with { info?, flow: [...] }, or a single step object.' };
    }

    // Normalize shorthand steps: { "actionName": args } → { action, args }
    steps = steps.map(normalizeStep);
  } catch {
    return { success: false, error: 'Invalid JSON. Provide a JSON array or a path to a JSON file.' };
  }

  // Validate and check requiresRary
  const raryFlag = process.argv.find(a => a.startsWith('--rary='));
  const cliRary = raryFlag ? raryFlag.slice('--rary='.length).split(',').map(s => s.trim()).filter(Boolean) : [];
  const { getActiveExtensions, listPackages } = await import('./rary.js');
  const activeNames = new Set(getActiveExtensions().map((e: any) => e.name));
  const installedNames = new Set(listPackages().map((p: any) => p.name));
  const raryError = validateRequiresRary(info, cliRary, activeNames, installedNames);
  if (raryError) {
    return { success: false, error: raryError };
  }

  // Build merged action map (built-in + rary extensions)
  const { loadExtensionActions } = await import('./rary.js');
  const extActions = await loadExtensionActions();
  const mergedActionMap: Record<string, (page: any, args: any) => Promise<{ result?: any }>> = { ...ACTION_MAP };

  // Check for built-in collisions
  const builtinCollisions = Object.keys(extActions.actions).filter(k => k in ACTION_MAP);
  if (builtinCollisions.length > 0) {
    return { success: false, error: `Extension action conflicts with built-in: ${builtinCollisions.join(', ')}` };
  }
  if (extActions.errors.length > 0) {
    return { success: false, error: 'Failed to load extension actions', data: { errors: extActions.errors } };
  }
  Object.assign(mergedActionMap, extActions.actions);

  const extraKnownActions = new Set(Object.keys(extActions.actions));

  // Validate syntax before execution
  const validationErrors = validateSteps(steps, '', extraKnownActions);
  if (validationErrors.length > 0) {
    return { success: false, error: 'Validation failed', data: { errors: validationErrors } };
  }

  // Check for shell actions and build warnings
  const warnings: string[] = [...extActions.warnings];
  const hasShell = steps.some(s => s.action === 'shell');
  if (hasShell && allowShell) {
    warnings.push('Warning: shell action enabled. Only run trusted sequences.');
  }
  if (hasShell && requestPermission) {
    warnings.push('Warning: shell actions require user approval.');
  }

  const vars = new VarStore();

  // --- --params: inject external parameters into VarStore ---
  const paramsArg = cliArgs.find((a: string) => a.startsWith('--params='))?.slice('--params='.length)
    || (cliArgs.indexOf('--params') >= 0 ? cliArgs[cliArgs.indexOf('--params') + 1] : undefined);

  if (paramsArg) {
    const paramsError = loadParams(vars, paramsArg);
    if (paramsError) return { success: false, error: paramsError };
  }

  const results: StepResult[] = [];
  const defs = new Map<string, DefEntry>();
  // Determine base directory for subflow path resolution
  const { dirname } = await import('path');
  const baseDir = existsSync(input) ? dirname(input.startsWith('/') || input.includes(':') ? input : (await import('path')).resolve(input)) : process.cwd();

  // Build runtime context with event handlers for extension actions
  const { buildRuntime, loadEventHandlers } = await import('./runtime.js');
  const { getActiveExtensions: getActiveExts, packageDir } = await import('./rary.js');
  const { findTabByPageIndex, findTabByUrl } = await import('./tab-registry.js');

  let eventHandlers: any[] = [];
  try {
    const loaded = await loadEventHandlers(
      () => getActiveExts().map((e: any) => ({ name: e.name, manifest: e.manifest })),
      packageDir,
    );
    eventHandlers = loaded.handlers;
  } catch {}

  // Resolve stable tabId for current page
  const pageIndex = page.context().pages().indexOf(page);
  const currentTab = (pageIndex >= 0 ? findTabByPageIndex(pageIndex) : undefined) || findTabByUrl(page.url());
  const tabId = currentTab?.tabId;

  const seqRuntime = buildRuntime({
    session,
    page,
    eventHandlers,
    tab: tabId != null ? { id: tabId, url: page.url() } : undefined,
  });

  const outcome = await runSteps(page, steps, vars, results, defs, 0, { allowShell, requestPermission, debugLog, baseDir, actionMap: mergedActionMap, runtime: seqRuntime });

  // Clean up heartbeat and lock
  clearInterval(heartbeat);
  releaseLock(lockPath);

  const path = screenshotPath(outcome.success ? 'sequence-done' : `sequence-error-${Date.now()}`, session);
  await page.screenshot({ path });

  return {
    success: outcome.success,
    screenshot: path,
    data: {
      ...(info ? { info } : {}),
      completed: results.filter(r => r.success).length,
      total: results.length,
      results,
      vars: vars.snapshot(),
    },
    ...(outcome.failedAt !== undefined ? { error: `Step ${outcome.failedAt} failed` } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
});
