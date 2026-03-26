// scroll.ts — 페이지/요소 스크롤
// Usage:
//   pw scroll down                    # 한 화면 아래로
//   pw scroll up                      # 한 화면 위로
//   pw scroll top                     # 맨 위로
//   pw scroll bottom                  # 맨 아래로
//   pw scroll "#element"              # 요소가 보일 때까지 스크롤
//   pw scroll down --px=500           # 500px 아래로
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
      // 셀렉터 → 요소까지 스크롤
      await page.locator(target).first().scrollIntoViewIfNeeded();
      break;
  }

  await page.waitForTimeout(300); // 스크롤 애니메이션 대기
  const path = screenshotPath();
  await page.screenshot({ path });

  const scrollY = await page.evaluate(() => window.scrollY);
  return { success: true, screenshot: path, data: { target, scrollY } };
});
