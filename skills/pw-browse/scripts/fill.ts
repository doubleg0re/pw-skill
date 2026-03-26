// ~/.claude/skills/pw-browse/scripts/fill.ts
import { run, screenshotPath } from './common.js';
import { actionFill } from './actions.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const text = args[1];
  if (!selector || !text) return { success: false, error: 'Usage: fill.ts <selector> <text>' };

  await actionFill(page, [selector, text]);

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector, text } };
});
