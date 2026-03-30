// ~/.claude/skills/pw-browse/scripts/click.ts
import { run, screenshotPath } from './common.js';
import { actionClick } from './actions.js';

run(async ({ page, args, session }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Target required. Usage: click.ts <target> [--mode=selector|text|coord]' };

  await actionClick(page, [target]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { target } };
});
