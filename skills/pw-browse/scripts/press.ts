// press.ts — send a real key event. Use this rather than `type` for anything that
// is not literal text: Enter, Escape, Tab, Delete, arrows, and modifier combos.
import { run, parseFlag, screenshotPath } from './common.js';
import { actionPress } from './actions.js';

run(async ({ page, args, session }) => {
  const key = args[0];
  if (!key) {
    return { success: false, error: 'Usage: press.ts <key> [--delay=ms]  (Enter, Escape, Tab, Delete, ArrowDown, cmd+z, ctrl+shift+z)' };
  }

  const delayStr = parseFlag(process.argv.slice(2), 'delay');
  const delay = delayStr ? parseInt(delayStr) : 0;

  const result = await actionPress(page, [key, String(delay)]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { ...result?.result, ...(delay ? { delay } : {}) } };
});
