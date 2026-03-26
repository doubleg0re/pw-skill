// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run, hasFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const fullPage = hasFlag(process.argv.slice(2), 'full');
  const path = screenshotPath();

  if (selector) {
    const element = await page.locator(selector).first();
    await element.screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage });
  }

  return { success: true, screenshot: path };
});
