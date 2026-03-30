// hover.ts — Hover mouse over element
import { run, screenshotPath, parseFlag } from './common.js';
import { actionHover } from './actions.js';

run(async ({ page, args, session }) => {
  const key = parseFlag(process.argv.slice(2), 'key');
  const target = args[0];
  if (!target && !key) return { success: false, error: 'Usage: hover.ts <target> [--key=<elementKey>]' };

  const actionArgs = key ? { key } : [target];
  const result = await actionHover(page, actionArgs, { session });

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { target: target || `key:${key}`, ...result?.result } };
});
