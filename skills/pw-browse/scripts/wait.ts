// wait.ts — 조건부 대기
// Usage:
//   pw wait 3000                              # 3초 대기
//   pw wait "#modal"                          # 셀렉터 visible 될 때까지
//   pw wait "#status" --attr=textContent --value=완료  # 셀렉터의 속성이 특정 값이 될 때까지
//   pw wait "#input" --attr=value --value=loaded       # input의 value가 "loaded"가 될 때까지
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Usage: wait.ts <ms | selector> [--attr=name --value=expected] [--timeout=ms]' };

  const timeoutStr = parseFlag(process.argv.slice(2), 'timeout');
  const timeout = timeoutStr ? parseInt(timeoutStr) : 30000;
  const attr = parseFlag(process.argv.slice(2), 'attr');
  const value = parseFlag(process.argv.slice(2), 'value');

  // 특정 시각까지 대기: "14:30" 또는 "14:30:00"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(target)) {
    const [h, m, s] = target.split(':').map(Number);
    const now = new Date();
    const t = new Date(now);
    t.setHours(h, m, s || 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    const ms = t.getTime() - now.getTime();
    await new Promise(resolve => setTimeout(resolve, ms));
    return { success: true, data: { until: target, waited: ms, type: 'until' } };
  }

  // 숫자면 시간 대기 (ms)
  if (/^\d+$/.test(target)) {
    await new Promise(resolve => setTimeout(resolve, parseInt(target)));
    return { success: true, data: { waited: parseInt(target), type: 'time' } };
  }

  // attr+value가 있으면 속성값 매칭 대기
  if (attr && value !== undefined) {
    await page.locator(target).first().waitFor({ state: 'attached', timeout });
    await page.waitForFunction(
      ({ sel, attr, value }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const actual = attr === 'textContent' ? el.textContent?.trim()
          : attr === 'innerText' ? (el as HTMLElement).innerText?.trim()
          : (el as HTMLElement).getAttribute(attr);
        return actual === value;
      },
      { sel: target, attr, value },
      { timeout },
    );
    const path = screenshotPath();
    await page.screenshot({ path });
    return { success: true, screenshot: path, data: { selector: target, attr, value, type: 'attr' } };
  }

  // 셀렉터만 있으면 visible 대기
  await page.locator(target).first().waitFor({ state: 'visible', timeout });
  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { selector: target, type: 'visible' } };
});
