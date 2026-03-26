// scroll.ts — Page/element scrolling
// Usage:
//   pw scroll down                    # one viewport down
//   pw scroll up                      # one viewport up
//   pw scroll top                     # scroll to top
//   pw scroll bottom                  # scroll to bottom
//   pw scroll "#element"              # scroll until element is visible
//   pw scroll down --px=500           # 500px down
import { run, parseFlag, screenshotPath } from './common.js';
import { actionScroll } from './actions.js';

run(async ({ page, args }) => {
  const target = args[0] || 'down';
  const pxStr = parseFlag(process.argv.slice(2), 'px');

  await actionScroll(page, [target, ...(pxStr ? [pxStr] : [])]);

  const path = screenshotPath();
  await page.screenshot({ path });

  const scrollY = await page.evaluate(() => window.scrollY);
  return { success: true, screenshot: path, data: { target, scrollY } };
});
