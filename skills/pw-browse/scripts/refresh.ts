// refresh.ts — Reload current page
import { run, hasFlag, screenshotPath } from './common.js';
import { actionRefresh } from './actions.js';

run(async ({ page }) => {
  const { result } = await actionRefresh(page, []);

  const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');

  let screenshot: string | undefined;
  if (takeScreenshot) {
    screenshot = screenshotPath();
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  return { success: true, data: result, ...(screenshot ? { screenshot } : {}) };
});
