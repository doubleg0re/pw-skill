// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run, hasFlag, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const fullPage = hasFlag(process.argv.slice(2), 'full');
  const name = parseFlag(process.argv.slice(2), 'name');
  const path = screenshotPath(name);

  if (selector && /^\d+,\d+,\d+,\d+$/.test(selector)) {
    const [x, y, width, height] = selector.split(',').map(Number);
    await page.screenshot({ path, clip: { x, y, width, height } });
  } else if (selector) {
    await page.locator(selector).first().screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage });
  }

  return { success: true, screenshot: path };
});
