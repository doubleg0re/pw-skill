// ~/.claude/skills/pw-browse/scripts/navigate.ts
import { run, hasFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const url = args[0];
  if (!url) return { success: false, error: 'URL required. Usage: navigate.ts <url> [--screenshot]' };

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  const title = await page.title();
  const takeScreenshot = hasFlag(process.argv.slice(2), 'screenshot');

  let screenshot: string | undefined;
  if (takeScreenshot) {
    screenshot = screenshotPath();
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  return { success: true, data: { url, title }, ...(screenshot ? { screenshot } : {}) };
});
