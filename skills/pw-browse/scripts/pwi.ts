#!/usr/bin/env npx tsx
// pwi — Lightweight one-shot browser runner
// Launches a temporary browser, executes action(s), and exits.
// No sessions, no CDP server, no hooks, no extensions.
// For session-based work, use pw instead.
//
// Usage:
//   pwi navigate https://example.com
//   pwi navigate https://example.com --screenshot
//   pwi navigate https://example.com --device="iPhone 12" --screenshot
//   pwi dump --selector="h1" --text
//   pwi navigate url :: click "#login" :: screenshot
import { chromium } from 'playwright';
import { ACTION_MAP } from './actions.js';
import { buildInlineStepArgs, parseChainSegments, CHAINABLE_ACTION_SET, handleDialogStep } from './chain-utils.js';
import { parseViewportSpec } from './common.js';
import {
  applyViewportOverride,
  buildDeviceContextOptions,
  getDevicePresetWarning,
  isDevicePresetDisabled,
  resolveDevicePreset,
} from './device-presets.js';

const EXCLUDED_ACTIONS = new Set([
  'launch', 'close', 'use', 'sessions', 'analyze', 'clean', 'rary', 'sequence',
]);

// --- Parse ---

const rawArgs = process.argv.slice(2);
const OPTION_FLAGS = new Set(['headed', 'screenshot', 'viewport', 'device']);
const { segments: steps } = parseChainSegments(
  rawArgs.filter(a => !a.startsWith('--') || !OPTION_FLAGS.has(a.replace(/^--/, '').split('=')[0])),
);
const headed = rawArgs.includes('--headed');
const takeScreenshot = rawArgs.includes('--screenshot');
const viewportFlag = rawArgs.find(a => a.startsWith('--viewport='));
const viewport = parseViewportSpec(viewportFlag?.split('=')[1]);
const deviceFlag = rawArgs.find(a => a.startsWith('--device='));
const devicePreset = deviceFlag && !isDevicePresetDisabled(deviceFlag.split('=')[1])
  ? applyViewportOverride(resolveDevicePreset(deviceFlag.split('=')[1]), viewportFlag ? viewport : undefined)
  : null;

if (steps.length === 0) {
  console.log(JSON.stringify({ success: false, error: 'Usage: pwi <action> [args...] [:: <action> [args...] ...]' }));
  process.exit(1);
}

for (const step of steps) {
  if (EXCLUDED_ACTIONS.has(step.action)) {
    console.log(JSON.stringify({ success: false, error: `"${step.action}" is not available in pwi. Use "pw ${step.action}" instead.` }));
    process.exit(1);
  }
  if (!ACTION_MAP[step.action] && step.action !== 'dialog') {
    console.log(JSON.stringify({ success: false, error: `Unknown action: "${step.action}". pwi only supports built-in actions.` }));
    process.exit(1);
  }
}

// --- Execute ---

async function main() {
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext(
    devicePreset ? buildDeviceContextOptions(devicePreset) : { viewport },
  );
  const page = await context.newPage();
  let pendingDialog: import('playwright').Dialog | null = null;
  page.on('dialog', d => {
    if (d.type() === 'beforeunload') {
      d.accept().catch(() => {});
    } else {
      pendingDialog = d;
    }
  });

  try {
    const results: any[] = [];
    let lastResult: any = null;

    for (const step of steps) {
      if (step.action === 'dialog') {
        const { data, cleared, error } = await handleDialogStep(pendingDialog, step.args[0], step.args[1]);
        if (error) throw new Error(error);
        if (cleared) pendingDialog = null;
        lastResult = data;
        results.push({ action: 'dialog', success: true, data: lastResult });
        continue;
      }

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

    const deviceWarning = devicePreset ? getDevicePresetWarning(devicePreset) : undefined;

    const output = {
      success: true,
      data: steps.length === 1 ? results[0].data : { results },
      ...(screenshotPath ? { screenshot: screenshotPath } : {}),
      ...(deviceWarning ? { warnings: [deviceWarning] } : {}),
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
