// ~/.claude/skills/pw-browse/scripts/dblclick.ts
import { run, screenshotPath } from './common.js';
import { actionDblclick } from './actions.js';

run(async ({ page, args }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Target required. Usage: dblclick.ts <target> [--mode=selector|text|coord]' };

  await actionDblclick(page, [target]);

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { target } };
});
