// sequence.ts — JSON-based action sequence + flow control engine (CLI entry)
//
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
//
// This file is intentionally thin after the Phase 2 refactor
// (.claude/docs/sequence-refactor.md). It is the CLI entrypoint plus a
// compatibility surface that re-exports everything the tests and other
// scripts used to import directly:
//
//   - Types            → sequence-types.ts
//   - Flow engine      → sequence-engine.ts (VarStore, runSteps, ...)
//   - Validators       → sequence-validate.ts
//   - Step normalization + params loading → sequence-params.ts

import { parseFlag, run, screenshotPath } from './common.js';
import { existsSync, readFileSync } from 'fs';
import { ACTION_MAP } from './actions.js';
import {
  VarStore,
  runSteps,
  evaluateCondition,
} from './sequence-engine.js';
import {
  validateSteps,
  validateRequiresRary,
  validateFlowParameters,
} from './sequence-validate.js';
import { normalizeStep, loadParams, loadParamsData } from './sequence-params.js';
import type {
  Step,
  StepResult,
  DefEntry,
} from './sequence-types.js';

// --- Re-exports for backwards compatibility ---
//
// Tests (tests/flow-engine.test.ts, tests/varstore.test.ts) and possibly
// future external callers still import these symbols from './sequence.js'.
// Keep the surface stable.

export type {
  LeafCondition,
  CompositeCondition,
  ConditionNode,
  Step,
  SubflowInfo,
  DefEntry,
  StepResult,
} from './sequence-types.js';

export { VarStore, runSteps, evaluateCondition, executeAction } from './sequence-engine.js';
export type { DialogState, RunOptions } from './sequence-engine.js';

export {
  validateSteps,
  validateRequiresRary,
  validateFlowParameters,
} from './sequence-validate.js';
export { normalizeStep, loadParams, loadParamsData } from './sequence-params.js';

// --- Entry point (only when run directly, not when imported) ---

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('/sequence.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/sequence.js');

if (isDirectRun) run(async ({ page, args: cliArgs, rawArgs, session }) => {
  const input = cliArgs[0];
  if (!input) return { success: false, error: 'Usage: sequence.ts <json-string | json-file-path>' };

  const allowShell = process.argv.includes('--allow-shell');
  const requestPermission = process.argv.includes('--request-permission');
  const debugLog = process.argv.includes('--debug-log');

  // Heartbeat lock for long-running sequences
  const { acquireLockOrThrow, releaseLock, refreshLock } = await import('./lock.js');
  const { join } = await import('path');
  const lockPath = join(process.cwd(), '.playwright-state', '.sequence.lock');
  acquireLockOrThrow(lockPath, 'sequence');
  const heartbeat = setInterval(() => refreshLock(lockPath), 30000);

  function cleanupLock() {
    clearInterval(heartbeat);
    releaseLock(lockPath);
  }

  try { // try/finally ensures cleanupLock runs on every exit path

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
  const paramsArg = parseFlag(rawArgs, 'params')
    || (rawArgs.indexOf('--params') >= 0 ? rawArgs[rawArgs.indexOf('--params') + 1] : undefined);
  const loadedParams = paramsArg
    ? loadParamsData(paramsArg)
    : { data: {} as Record<string, any> };

  if (loadedParams.error) {
    return { success: false, error: loadedParams.error };
  }

  const flowParametersError = validateFlowParameters(info, loadedParams.data || {});
  if (flowParametersError) {
    return { success: false, error: flowParametersError };
  }

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
  const { resolveTab } = await import('./tab-registry.js');

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
  const currentTab = resolveTab(page.url(), pageIndex >= 0 ? pageIndex : undefined);
  const tabId = currentTab?.tabId;

  const seqRuntime = buildRuntime({
    session,
    page,
    eventHandlers,
    tab: tabId != null ? { id: tabId, url: page.url() } : undefined,
  });

  const outcome = await runSteps(page, steps, vars, results, defs, 0, { allowShell, requestPermission, debugLog, baseDir, actionMap: mergedActionMap, runtime: seqRuntime });

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
    ...(outcome.pendingDialog ? { pendingDialog: outcome.pendingDialog } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  } finally {
    cleanupLock();
  }
});
