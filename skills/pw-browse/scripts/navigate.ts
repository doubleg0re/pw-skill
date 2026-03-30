// ~/.claude/skills/pw-browse/scripts/navigate.ts
import { run, hasFlag, screenshotPath } from './common.js';
import { actionNavigate } from './actions.js';
import { advanceDocumentEpoch } from './session.js';

run(async ({ page, args, session }) => {
  const url = args[0];
  if (!url) return { success: false, error: 'URL required. Usage: navigate.ts <url> [--screenshot]' };

  const { result } = await actionNavigate(page, [url]);

  advanceDocumentEpoch(session.name);

  const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');

  let screenshot: string | undefined;
  if (takeScreenshot) {
    screenshot = screenshotPath(undefined, session);
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  return { success: true, data: result, ...(screenshot ? { screenshot } : {}) };
});
