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

/** Split raw argv into steps separated by "::" */
function parseInlineSteps(argv: string[]): { steps: InlineStep[]; flags: string[] } {
  const flags: string[] = [];
  const tokens: string[] = [];

  // Separate global flags from action tokens
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      flags.push(arg);
    } else {
      tokens.push(arg);
    }
  }

  if (tokens.length === 0) {
    return { steps: [], flags };
  }

  // Split by "::" separator
  const segments: string[][] = [];
  let current: string[] = [];
  for (const t of tokens) {
    if (t === '::') {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) segments.push(current);

  const steps: InlineStep[] = segments.map(seg => ({
    action: seg[0],
    args: seg.slice(1),
  }));

  return { steps, flags };
}

/** Convert InlineStep[] to sequence engine Step[] format */
function toSequenceSteps(steps: InlineStep[]): any[] {
  return steps.map(s => ({
    action: s.action,
    args: s.args,
  }));
}

// --- Supported actions (browser actions only, no session/maintenance) ---
const EXCLUDED_ACTIONS = new Set([
  'launch', 'close', 'use', 'sessions', 'analyze', 'clean', 'rary', 'sequence',
]);

// --- Main ---

const rawArgs = process.argv.slice(2);
const { steps, flags } = parseInlineSteps(rawArgs);

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

    const { actions: extActions, warnings } = await loadExtensionActions();
    const mergedActionMap = { ...ACTION_MAP, ...extActions };

    const vars = new VarStore();
    const result = await executeAction(page, step.action, step.args, vars, mergedActionMap);
    return {
      success: true,
      data: result?.result ?? result,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
} else {
  // Multi-step: compile to sequence steps and run through sequence engine
  run(async ({ page }) => {
    const { VarStore, runSteps, validateSteps } = await import('./sequence.js');
    const { loadExtensionActions } = await import('./rary.js');

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

    return {
      success: outcome.success,
      data: { results },
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(!outcome.success && outcome.failedAt !== undefined
        ? { error: `Step ${outcome.failedAt} failed` }
        : {}),
    };
  });
}
