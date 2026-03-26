// ~/.claude/skills/pw-browse/scripts/type.ts
import { run, parseFlag, screenshotPath } from './common.js';
import { actionType } from './actions.js';

run(async ({ page, args }) => {
  const text = args[0];
  if (!text) return { success: false, error: 'Usage: type.ts <text> [--delay=ms]' };

  const delayStr = parseFlag(process.argv.slice(2), 'delay');
  const delay = delayStr ? parseInt(delayStr) : 0;

  await actionType(page, [text, String(delay)]);

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { text, delay } };
});
