// scroll.ts — Page/element scrolling
// Usage:
//   pw scroll down                    # one viewport down
//   pw scroll up                      # one viewport up
//   pw scroll top                     # scroll to top
//   pw scroll bottom                  # scroll to bottom
//   pw scroll "#element"              # scroll until element is visible
//   pw scroll down --px=500           # 500px down
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const target = args[0] || 'down';
  const pxStr = parseFlag(process.argv.slice(2), 'px');
  const px = pxStr ? parseInt(pxStr) : undefined;

  switch (target) {
    case 'down':
      await page.evaluate((px) => window.scrollBy(0, px || window.innerHeight), px);
      break;
    case 'up':
      await page.evaluate((px) => window.scrollBy(0, -(px || window.innerHeight)), px);
      break;
    case 'top':
      await page.evaluate(() => window.scrollTo(0, 0));
      break;
    case 'bottom':
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      break;
    default:
      // Selector -> scroll to element
      await page.locator(target).first().scrollIntoViewIfNeeded();
      break;
  }

  await page.waitForTimeout(300); // Wait for scroll animation
  const path = screenshotPath();
  await page.screenshot({ path });

  const scrollY = await page.evaluate(() => window.scrollY);
  return { success: true, screenshot: path, data: { target, scrollY } };
});
