#!/usr/bin/env npx tsx
// pwi — Lightweight one-shot browser runner
// Launches a temporary browser, executes action(s), and exits.
// No sessions, no CDP server, no hooks, no extensions.
// For session-based work, use pw instead.
//
// Usage:
//   pwi navigate https://example.com
//   pwi navigate https://example.com --screenshot
//   pwi dump --selector="h1" --text
//   pwi navigate url :: click "#login" :: screenshot
import { chromium } from 'playwright';
import { ACTION_MAP } from './actions.js';
import { buildInlineStepArgs } from './chain-utils.js';

// --- Arg parser ---

interface InlineStep {
  action: string;
  args: string[];
}

const OPTION_FLAGS = new Set(['headed', 'screenshot', 'viewport']);

function isOptionFlag(arg: string): boolean {
  if (!arg.startsWith('--')) return false;
  const name = arg.replace(/^--/, '').split('=')[0];
  return OPTION_FLAGS.has(name);
}

function parseInlineSteps(argv: string[]): { steps: InlineStep[] } {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const arg of argv) {
    if (arg === '::') {
      if (current.length > 0) segments.push(current);
      current = [];
    } else if (isOptionFlag(arg)) {
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

const EXCLUDED_ACTIONS = new Set([
  'launch', 'close', 'use', 'sessions', 'analyze', 'clean', 'rary', 'sequence',
]);

// --- Parse ---

const rawArgs = process.argv.slice(2);
const { steps } = parseInlineSteps(rawArgs);
const headed = rawArgs.includes('--headed');
const takeScreenshot = rawArgs.includes('--screenshot');
const viewportFlag = rawArgs.find(a => a.startsWith('--viewport='));
const viewportSpec = viewportFlag?.split('=')[1];
const viewport = !viewportSpec || viewportSpec === 'auto'
  ? null
  : { width: parseInt(viewportSpec.split('x')[0]), height: parseInt(viewportSpec.split('x')[1]) };

if (steps.length === 0) {
  console.log(JSON.stringify({ success: false, error: 'Usage: pwi <action> [args...] [:: <action> [args...] ...]' }));
  process.exit(1);
}

for (const step of steps) {
  if (EXCLUDED_ACTIONS.has(step.action)) {
    console.log(JSON.stringify({ success: false, error: `"${step.action}" is not available in pwi. Use "pw ${step.action}" instead.` }));
    process.exit(1);
  }
  if (!ACTION_MAP[step.action]) {
    console.log(JSON.stringify({ success: false, error: `Unknown action: "${step.action}". pwi only supports built-in actions.` }));
    process.exit(1);
  }
}

// --- Execute ---

async function main() {
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    const results: any[] = [];
    let lastResult: any = null;

    for (const step of steps) {
      const actionArgs = buildInlineStepArgs(step.args, { $ret: lastResult });
      const result = await ACTION_MAP[step.action](page, actionArgs);
      lastResult = result?.result ?? result;
      results.push({ action: step.action, success: true, data: lastResult });
    }

    let screenshotPath: string | undefined;
    if (takeScreenshot) {
      const { ensureStateDir, screenshotPath: getPath } = await import('./common.js');
      ensureStateDir();
      screenshotPath = getPath();
      await page.screenshot({ path: screenshotPath });
    }

    const output = {
      success: true,
      data: steps.length === 1 ? results[0].data : { results },
      ...(screenshotPath ? { screenshot: screenshotPath } : {}),
    };

    console.log(JSON.stringify(output));
  } catch (err: any) {
    console.log(JSON.stringify({ success: false, error: err.message }));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
