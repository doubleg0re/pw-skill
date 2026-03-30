// hover.ts — Hover mouse over element
import { run, screenshotPath } from './common.js';
import { actionHover } from './actions.js';

run(async ({ page, args, session }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Usage: hover.ts <target>' };

  await actionHover(page, [target]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { target } };
});
