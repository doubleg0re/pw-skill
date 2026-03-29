#!/usr/bin/env npx tsx
// pwi — Lightweight inline action runner for pw-skill
// Connects to browser directly without loading hooks, event handlers,
// or runtime extensions. For full runtime, use pw :: chaining or pw sequence.
//
// Usage:
//   pwi navigate https://example.com
//   pwi click "#login"
//   pwi dump --selector="#app" --text
//   pwi navigate url :: click "#btn"       (multi-step → full runtime fallback)
//   pwi navigate url --full                (force full runtime)
import { ACTION_MAP } from './actions.js';

// --- Inline arg parser ---

interface InlineStep {
  action: string;
  args: string[];
}

const GLOBAL_FLAGS = new Set(['session', 'headed', 'viewport', 'video', 'tab', 'no-restore', 'screenshot', 'full']);

function isGlobalFlag(arg: string): boolean {
  if (!arg.startsWith('--')) return false;
  const name = arg.replace(/^--/, '').split('=')[0];
  return GLOBAL_FLAGS.has(name);
}

function parseInlineSteps(argv: string[]): { steps: InlineStep[] } {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const arg of argv) {
    if (arg === '::') {
      if (current.length > 0) segments.push(current);
      current = [];
    } else if (isGlobalFlag(arg)) {
      // skip — handled separately
    } else {
      current.push(arg);
    }
  }
  if (current.length > 0) segments.push(current);

  return {
    steps: segments.map(seg => ({ action: seg[0], args: seg.slice(1) })),
  };
}

function buildActionArgs(args: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  let positionalIndex = 0;
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        result[arg.slice(2)] = true;
      }
    } else {
      result[positionalIndex] = arg;
      positionalIndex++;
    }
  }
  return result;
}

const EXCLUDED_ACTIONS = new Set([
  'launch', 'close', 'use', 'sessions', 'analyze', 'clean', 'rary', 'sequence',
]);

// --- Parse ---

const rawArgs = process.argv.slice(2);
const { steps } = parseInlineSteps(rawArgs);
const hasFullFlag = rawArgs.includes('--full');
const hasScreenshotFlag = rawArgs.includes('--screenshot');

if (steps.length === 0) {
  console.log(JSON.stringify({ success: false, error: 'Usage: pwi <action> [args...] [:: <action> [args...] ...]' }));
  process.exit(1);
}

for (const step of steps) {
  if (EXCLUDED_ACTIONS.has(step.action)) {
    console.log(JSON.stringify({ success: false, error: `"${step.action}" is not available in inline mode. Use "pw ${step.action}" instead.` }));
    process.exit(1);
  }
}

// --- Execution ---

// Multi-step or --full → delegate to full runtime (run() with hooks, events, extensions)
if (steps.length > 1 || hasFullFlag) {
  const { run } = await import('./common.js');
  run(async ({ page }) => {
    const { VarStore, runSteps, validateSteps } = await import('./sequence.js');
    const { loadExtensionActions } = await import('./rary.js');
    const { hasFlag, screenshotPath } = await import('./common.js');

    const seqSteps = steps.map(s => ({ action: s.action, args: buildActionArgs(s.args) }));
    const { actions: extActions, warnings } = await loadExtensionActions();
    const mergedActionMap = { ...ACTION_MAP, ...extActions };

    const errors = validateSteps(seqSteps, mergedActionMap);
    if (errors.length > 0) return { success: false, error: errors.join('; ') };

    const vars = new VarStore();
    const results: any[] = [];
    const outcome = await runSteps(page, seqSteps, vars, results, new Map(), 0, { actionMap: mergedActionMap });

    let finalScreenshot;
    if (hasScreenshotFlag && outcome.success) {
      finalScreenshot = screenshotPath();
      await page.screenshot({ path: finalScreenshot });
    }

    return {
      success: outcome.success,
      data: steps.length === 1 ? (results[0]?.data ?? results[0]) : { results },
      ...(finalScreenshot ? { screenshot: finalScreenshot } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(!outcome.success && outcome.failedAt !== undefined ? { error: `Step ${outcome.failedAt} failed` } : {}),
    };
  });
} else {
  // --- Lightweight path: single step, no hooks/extensions/runtime ---
  const step = steps[0];

  try {
    const { connectBrowser, parseArgs, hasFlag, parseFlag, screenshotPath, output } = await import('./common.js');
    const cliArgs = parseArgs();

    const { browser, context, page, session } = await connectBrowser({
      headless: !hasFlag(cliArgs, 'headed'),
      sessionName: parseFlag(cliArgs, 'session'),
      restoreUrl: !hasFlag(cliArgs, 'no-restore'),
    });

    // Execute action directly from ACTION_MAP (no extension actions, no runtime)
    const actionFn = ACTION_MAP[step.action];
    if (!actionFn) {
      output({ success: false, error: `Unknown action: "${step.action}". Use --full for extension actions.` });
      process.exit(1);
    }

    const actionArgs = buildActionArgs(step.args);
    const result = await actionFn(page, actionArgs);

    let finalScreenshot;
    if (hasScreenshotFlag) {
      finalScreenshot = screenshotPath();
      await page.screenshot({ path: finalScreenshot });
    }

    output({
      success: true,
      data: result?.result ?? result,
      ...(finalScreenshot ? { screenshot: finalScreenshot } : {}),
    });
    process.exit(0);
  } catch (err: any) {
    const { output, buildErrorResult } = await import('./common.js');
    output(buildErrorResult ? buildErrorResult(err) : { success: false, error: err.message });
    process.exit(1);
  }
}
