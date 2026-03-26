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

interface Step {
  action?: string;
  args?: string[] | Record<string, any>;
  out?: string;
  // label / goto
  label?: string;
  // def / call
  name?: string;
  params?: string[];
  // log
  text?: string;
  // condition
  ref?: string;
  eq?: any;
  neq?: any;
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
  then?: Step[];
  else?: Step[];
  // each
  as?: string;
  do?: Step[];
  // loop
  count?: number;
}

const MAX_JUMPS = 100;

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

  /** Replace {{var.path}} templates with actual values */
  interpolate(str: string): string {
    return str.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const value = this.get(path.trim());
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /** Interpolate the entire args array */
  interpolateArgs(args: string[]): string[] {
    return args.map(a => this.interpolate(a));
  }

  snapshot(): Record<string, any> {
    return { ...this.vars };
  }
}

// --- Action executor ---

export async function executeAction(
  page: Page,
  action: string,
  rawArgs: string[],
  vars: VarStore,
): Promise<{ result?: any }> {
  const a = vars.interpolateArgs(rawArgs);
  const fn = ACTION_MAP[action];
  if (!fn) throw new Error(`Unknown action: ${action}`);
  return fn(page, a);
}

// --- Flow engine ---

export async function runSteps(
  page: Page,
  steps: Step[],
  vars: VarStore,
  results: StepResult[],
  defs: Map<string, { params: string[]; body: Step[] }>,
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

      // --- def (function definition) ---
      if (step.action === 'def') {
        defs.set(step.name!, { params: step.params || [], body: step.do || [] });
        results.push({ step: stepIndex, action: 'def', success: true, data: { name: step.name, params: step.params } });
        i++;
        continue;
      }

      // --- call (function invocation) ---
      if (step.action === 'call') {
        const def = defs.get(step.name!);
        if (!def) {
          results.push({ step: stepIndex, action: 'call', success: false, error: `"${step.name}" is not defined` });
          return { success: false, failedAt: stepIndex };
        }
        // Inject args: arrays map by params order, objects map by key
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
        const refValue = vars.get(vars.interpolate(step.ref!));
        let matched = false;

        const resolve = (v: any) => typeof v === 'string' ? vars.interpolate(v) : v;

        if ('eq' in step) matched = refValue == resolve(step.eq);
        else if ('neq' in step) matched = refValue != resolve(step.neq);
        else if ('gt' in step) matched = Number(refValue) > Number(resolve(step.gt));
        else if ('lt' in step) matched = Number(refValue) < Number(resolve(step.lt));
        else if ('contains' in step) matched = String(refValue ?? '').includes(String(resolve(step.contains)));
        else if ('exists' in step) matched = step.exists ? refValue != null : refValue == null;

        const branch = matched ? step.then : step.else;
        results.push({ step: stepIndex, action: 'condition', success: true, data: { ref: step.ref, value: refValue, matched } });

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
      // args: use as-is if array, convert object values to array
      const rawArgs = !step.args ? [] : Array.isArray(step.args) ? step.args : Object.values(step.args).map(String);
      const { result } = await executeAction(page, step.action!, rawArgs, vars);

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

  const vars = new VarStore();
  const results: StepResult[] = [];
  const defs = new Map<string, { params: string[]; body: Step[] }>();
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
