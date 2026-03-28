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
  // label / goto
  label?: string;
  // def / call
  type?: 'func' | 'condition';
  name?: string;
  params?: string[];
  items?: Step[] | ConditionNode[];
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
  do?: Step[];
  // loop
  count?: number;
  // try/catch/finally
  catch?: Step[];
  finally?: Step[];
  [key: `catch:${string}`]: Step[] | undefined;
  // wait user-action
  prompt?: string;
}

const MAX_JUMPS = 100;

export type DefEntry =
  | { kind: 'block'; params: string[]; body: Step[] }
  | { kind: 'condition'; condition: ConditionNode };

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

  /** Interpolate the entire args array or object */
  interpolateArgs(args: string[] | Record<string, any>): any {
    if (Array.isArray(args)) {
      return args.map(a => this.interpolate(a));
    }
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      result[k] = this.interpolate(v);
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
): Promise<{ result?: any }> {
  const a = vars.interpolateArgs(rawArgs);
  const fn = ACTION_MAP[action] as (page: Page, a: any) => Promise<{ result?: any }>;
  if (!fn) throw new Error(`Unknown action: ${action}`);

  // Now 'a' can be either string[] or Record<string, any>
  // Both are accepted by the refactored actions in actions.ts
  return fn(page, a);
}

// --- Flow engine ---

export async function runSteps(
  page: Page,
  steps: Step[],
  vars: VarStore,
  results: StepResult[],
  defs: Map<string, DefEntry>,
  baseIndex: number = 0,
): Promise<{ success: boolean; failedAt?: number; goto?: string }> {
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
        const tryBody = step.do || [];
        const finallyBody = step.finally || [];
        let trySub = await runSteps(page, tryBody, vars, results, defs, stepIndex * 1000);

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
            const catchSub = await runSteps(page, catchBody, vars, results, defs, stepIndex * 2000);
            if (catchSub.goto) {
              // Run finally before goto
              if (finallyBody.length > 0) {
                await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000);
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
              await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000);
            }
            return { success: false, failedAt: stepIndex };
          }
        } else {
          results.push({ step: stepIndex, action: 'try', success: true, data: { caught: false } });

          // Handle goto from try body
          if (trySub.goto) {
            if (finallyBody.length > 0) {
              await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000);
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
          await runSteps(page, finallyBody, vars, results, defs, stepIndex * 3000);
        }

        i++;
        continue;
      }

      // --- def (func or condition) ---
      if (step.action === 'def') {
        const defType = step.type || 'func';
        if (defType === 'condition') {
          // items is ConditionNode[] — wrap in "or" if multiple, use single if one
          const condItems = (step.items || []) as ConditionNode[];
          const condition: ConditionNode = condItems.length === 1 ? condItems[0] : { or: condItems };
          defs.set(step.name!, { kind: 'condition', condition });
        } else {
          // func: items is Step[]
          defs.set(step.name!, { kind: 'block', params: step.params || [], body: (step.items || step.do || []) as Step[] });
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

        // Block def: inject args and run body
        if (step.args) {
          if (Array.isArray(step.args)) {
            def.params.forEach((p, idx) => {
              const v = (step.args as string[])[idx];
              vars.set(p, typeof v === 'string' ? vars.interpolate(v) : v);
            });
          } else {
            for (const [k, v] of Object.entries(step.args)) {
              vars.set(k, typeof v === 'string' ? vars.interpolate(v) : v);
            }
          }
        }
        results.push({ step: stepIndex, action: 'call', success: true, data: { name: step.name } });
        const sub = await runSteps(page, def.body, vars, results, defs, stepIndex * 1000);
        if (!sub.success) return sub;
        // Store call result to out (data from the last step)
        if (step.out) {
          const lastResult = results[results.length - 1];
          vars.set(step.out, lastResult?.data);
        }
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
          const sub = await runSteps(page, branch, vars, results, defs, stepIndex * 1000);
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
        const body = step.do || [];

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

      // --- loop ---
      if (step.action === 'loop') {
        const count = step.count ?? 1;
        const body = step.do || [];
        results.push({ step: stepIndex, action: 'loop', success: true, data: { count } });

        let loopGoto = false;
        for (let j = 0; j < count; j++) {
          vars.set('$index', j);
          const sub = await runSteps(page, body, vars, results, defs, (stepIndex * 1000) + (j * 100));
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
        }
        if (loopGoto) continue;
        i++;
        continue;
      }

      // --- General action ---
      // args: pass as-is (array or object) to the executor
      const { result } = await executeAction(page, step.action!, step.args || [], vars);

      if (step.out) {
        vars.set(step.out, result);
      }

      results.push({ step: stepIndex, action: step.action!, success: true, ...(result !== undefined ? { data: result } : {}) });
    } catch (err) {
      results.push({
        step: stepIndex,
        action: step.action || 'unknown',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      const path = screenshotPath(`sequence-error-${Date.now()}`);
      try { await page.screenshot({ path }); } catch {}
      return { success: false, failedAt: stepIndex };
    }
    i++;
  }
  return { success: true };
}

// --- Syntax validator ---

const KNOWN_ACTIONS = new Set([
  'navigate', 'click', 'dblclick', 'drag', 'fill', 'type', 'wait', 'hover',
  'scroll', 'select', 'upload', 'attr', 'submit', 'fetch', 'screenshot',
  'evaluate', 'log', 'condition', 'each', 'loop', 'def', 'call', 'goto', 'try',
]);

export function validateSteps(steps: Step[], prefix: string = ''): string[] {
  const errors: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const loc = `${prefix}Step ${i}`;

    // Label-only step
    if (!step.action && step.label) continue;
    if (!step.action && !step.label) {
      errors.push(`${loc}: step has no action or label`);
      continue;
    }

    const action = step.action!;

    // Unknown action
    if (!KNOWN_ACTIONS.has(action)) {
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
      if (step.type && step.type !== 'func' && step.type !== 'condition') {
        errors.push(`${loc}: def type must be "func" or "condition"`);
      }
    }

    // call
    if (action === 'call') {
      if (!step.name) errors.push(`${loc}: call requires "name"`);
    }

    // each
    if (action === 'each') {
      if (!step.ref) errors.push(`${loc}: each requires "ref"`);
      if (!step.do) errors.push(`${loc}: each requires "do"`);
    }

    // loop
    if (action === 'loop') {
      if (step.count === undefined || typeof step.count !== 'number') {
        errors.push(`${loc}: loop requires numeric "count"`);
      }
      if (!step.do) errors.push(`${loc}: loop requires "do"`);
    }

    // try
    if (action === 'try') {
      if (!step.do || !Array.isArray(step.do)) {
        errors.push(`${loc}: try requires "do" array`);
      }
      if (step.finally && !Array.isArray(step.finally)) {
        errors.push(`${loc}: try "finally" must be an array`);
      }
    }

    // goto
    if (action === 'goto') {
      if (!step.label) errors.push(`${loc}: goto requires "label"`);
    }

    // Recurse into nested steps
    if (step.do) errors.push(...validateSteps(step.do, `${loc}.do → `));
    if (step.then) errors.push(...validateSteps(step.then, `${loc}.then → `));
    if (step.else) errors.push(...validateSteps(step.else, `${loc}.else → `));
    if (step.finally) errors.push(...validateSteps(step.finally as Step[], `${loc}.finally → `));
  }

  return errors;
}

// --- Entry point ---

run(async ({ page, args: cliArgs }) => {
  const input = cliArgs[0];
  if (!input) return { success: false, error: 'Usage: sequence.ts <json-string | json-file-path>' };

  let steps: Step[];
  try {
    if (existsSync(input)) {
      steps = JSON.parse(readFileSync(input, 'utf-8'));
    } else {
      steps = JSON.parse(input);
    }
  } catch {
    return { success: false, error: 'Invalid JSON. Provide a JSON array or a path to a JSON file.' };
  }

  if (!Array.isArray(steps)) return { success: false, error: 'JSON must be an array of steps.' };

  // Validate syntax before execution
  const validationErrors = validateSteps(steps);
  if (validationErrors.length > 0) {
    return { success: false, error: 'Validation failed', data: { errors: validationErrors } };
  }

  const vars = new VarStore();
  const results: StepResult[] = [];
  const defs = new Map<string, DefEntry>();
  const outcome = await runSteps(page, steps, vars, results, defs);

  const path = screenshotPath(outcome.success ? 'sequence-done' : `sequence-error-${Date.now()}`);
  await page.screenshot({ path });

  return {
    success: outcome.success,
    screenshot: path,
    data: {
      completed: results.filter(r => r.success).length,
      total: results.length,
      results,
      vars: vars.snapshot(),
    },
    ...(outcome.failedAt !== undefined ? { error: `Step ${outcome.failedAt} failed` } : {}),
  };
});
