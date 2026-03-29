#!/usr/bin/env npx tsx
// pwi — Inline action shorthand for pw-skill
// Usage:
//   pwi navigate https://example.com
//   pwi click "#login" :: fill "#email" "admin@test.com" :: click "#submit"
//   pwi dump --selector="#app" --text --session=dev
import { run } from './common.js';
import { ACTION_MAP } from './actions.js';

// --- Inline arg parser ---

interface InlineStep {
  action: string;
  args: string[];
}

// Global flags consumed by run() via process.argv — not forwarded to actions
const GLOBAL_FLAGS = new Set(['session', 'headed', 'viewport', 'video', 'tab', 'no-restore', 'screenshot']);

function isGlobalFlag(arg: string): boolean {
  if (!arg.startsWith('--')) return false;
  const name = arg.replace(/^--/, '').split('=')[0];
  return GLOBAL_FLAGS.has(name);
}

/** Split raw argv into steps separated by "::" — per-step flags stay with their step */
function parseInlineSteps(argv: string[]): { steps: InlineStep[] } {
  // All tokens except "::" — global flags are left in process.argv for run()
  const segments: string[][] = [];
  let current: string[] = [];

  for (const arg of argv) {
    if (arg === '::') {
      if (current.length > 0) segments.push(current);
      current = [];
    } else if (isGlobalFlag(arg)) {
      // skip — run() reads these from process.argv directly
    } else {
      current.push(arg);
    }
  }
  if (current.length > 0) segments.push(current);

  const steps: InlineStep[] = segments.map(seg => ({
    action: seg[0],
    args: seg.slice(1), // includes per-step flags like --selector, --text
  }));

  return { steps };
}

/**
 * Convert step args (mix of positional and --flag tokens) into a Record
 * that ActionArgs consumers can read by name or index.
 *
 * Examples:
 *   ["#app", "--text"]           → { 0: "#app", selector: "#app", text: true }
 *   ["--selector=h1", "--text"]  → { selector: "h1", text: true }
 *   ["https://example.com"]      → { 0: "https://example.com", url: "https://example.com" }
 */
function buildActionArgs(args: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  let positionalIndex = 0;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const key = arg.slice(2, eqIndex);
        result[key] = arg.slice(eqIndex + 1);
      } else {
        result[arg.slice(2)] = true;
      }
    } else {
      result[positionalIndex] = arg;
      positionalIndex++;
    }
  }

  // Map common positional aliases for actions that use getArg(a, name, index)
  if (result[0] !== undefined && !result.url && !result.selector) {
    // First positional is typically url or selector depending on action
    // Leave index-based — getArg will find it by index
  }

  return result;
}

/** Convert InlineStep[] to sequence engine Step[] format */
function toSequenceSteps(steps: InlineStep[]): any[] {
  return steps.map(s => ({
    action: s.action,
    args: buildActionArgs(s.args),
  }));
}

// --- Supported actions (browser actions only, no session/maintenance) ---
const EXCLUDED_ACTIONS = new Set([
  'launch', 'close', 'use', 'sessions', 'analyze', 'clean', 'rary', 'sequence',
]);

// --- Main ---

const rawArgs = process.argv.slice(2);
const { steps } = parseInlineSteps(rawArgs);

if (steps.length === 0) {
  console.log(JSON.stringify({
    success: false,
    error: 'Usage: pwi <action> [args...] [:: <action> [args...] ...]',
  }));
  process.exit(1);
}

// Validate: no excluded commands
for (const step of steps) {
  if (EXCLUDED_ACTIONS.has(step.action)) {
    console.log(JSON.stringify({
      success: false,
      error: `"${step.action}" is not available in inline mode. Use "pw ${step.action}" instead.`,
    }));
    process.exit(1);
  }
}

// Single step: run directly as action
if (steps.length === 1) {
  const step = steps[0];

  run(async ({ page }) => {
    const { VarStore, executeAction } = await import('./sequence.js');
    const { loadExtensionActions } = await import('./rary.js');
    const { hasFlag, screenshotPath } = await import('./common.js');

    const { actions: extActions, warnings } = await loadExtensionActions();
    const mergedActionMap = { ...ACTION_MAP, ...extActions };

    const vars = new VarStore();
    const actionArgs = buildActionArgs(step.args);
    const result = await executeAction(page, step.action, actionArgs, vars, mergedActionMap);

    const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');
    let finalScreenshot;
    if (takeScreenshot) {
      finalScreenshot = screenshotPath();
      await page.screenshot({ path: finalScreenshot });
    }

    return {
      success: true,
      data: result?.result ?? result,
      ...(finalScreenshot ? { screenshot: finalScreenshot } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
} else {
  // Multi-step: compile to sequence steps and run through sequence engine
  run(async ({ page }) => {
    const { VarStore, runSteps, validateSteps } = await import('./sequence.js');
    const { loadExtensionActions } = await import('./rary.js');
    const { hasFlag, screenshotPath } = await import('./common.js');

    const seqSteps = toSequenceSteps(steps);

    // Load extension actions
    const { actions: extActions, warnings } = await loadExtensionActions();
    const mergedActionMap = { ...ACTION_MAP, ...extActions };

    // Validate steps
    const errors = validateSteps(seqSteps, mergedActionMap);
    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }

    const vars = new VarStore();
    const results: any[] = [];
    const defs = new Map();

    const outcome = await runSteps(page, seqSteps, vars, results, defs, 0, {
      actionMap: mergedActionMap,
    });

    const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');
    let finalScreenshot;
    if (takeScreenshot && outcome.success) {
      finalScreenshot = screenshotPath();
      await page.screenshot({ path: finalScreenshot });
    }

    return {
      success: outcome.success,
      data: { results },
      ...(finalScreenshot ? { screenshot: finalScreenshot } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(!outcome.success && outcome.failedAt !== undefined
        ? { error: `Step ${outcome.failedAt} failed` }
        : {}),
    };
  });
}
