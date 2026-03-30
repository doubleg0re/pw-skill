// ~/.claude/skills/pw-browse/scripts/drag.ts
import { run, screenshotPath } from './common.js';
import { actionDrag } from './actions.js';

run(async ({ page, args, session }) => {
  const source = args[0];
  const target = args[1];
  if (!source || !target) return { success: false, error: 'Usage: drag.ts <source> <target>' };

  await actionDrag(page, [source, target]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { source, target } };
});
