// refresh.ts — Reload current page
import { run, hasFlag, screenshotPath } from './common.js';
import { actionRefresh } from './actions.js';
import { advanceDocumentEpoch } from './session.js';

run(async ({ page, session }) => {
  const { result } = await actionRefresh(page, []);

  advanceDocumentEpoch(session.name);

  const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');

  let screenshot: string | undefined;
  if (takeScreenshot) {
    screenshot = screenshotPath(undefined, session);
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  return { success: true, data: result, ...(screenshot ? { screenshot } : {}) };
});
