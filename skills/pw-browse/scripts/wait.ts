// wait.ts — Conditional wait
// Usage:
//   pw wait 3000                              # wait 3 seconds
//   pw wait "#modal"                          # wait until selector is visible
//   pw wait "#status" --attr=textContent --value=done  # wait until selector attribute matches value
//   pw wait "#input" --attr=value --value=loaded       # wait until input value becomes "loaded"
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Usage: wait.ts <ms | selector> [--attr=name --value=expected] [--timeout=ms]' };

  const timeoutStr = parseFlag(process.argv.slice(2), 'timeout');
  const timeout = timeoutStr ? parseInt(timeoutStr) : 30000;
  const attr = parseFlag(process.argv.slice(2), 'attr');
  const value = parseFlag(process.argv.slice(2), 'value');

  // Wait until specific time: "14:30" or "14:30:00"
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

  // Wait for URL pattern: starts with "http" or "/"
  if (target.startsWith('http') || target.startsWith('/')) {
    await page.waitForURL(target.includes('*') ? target : `**${target}*`, { timeout });
    const path = screenshotPath();
    await page.screenshot({ path });
    return { success: true, screenshot: path, data: { url: page.url(), type: 'url' } };
  }

  // If numeric, wait for duration (ms)
  if (/^\d+$/.test(target)) {
    await new Promise(resolve => setTimeout(resolve, parseInt(target)));
    return { success: true, data: { waited: parseInt(target), type: 'time' } };
  }

  // If attr+value present, wait for attribute value match
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

  // If only selector, wait for visible
  await page.locator(target).first().waitFor({ state: 'visible', timeout });
  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { selector: target, type: 'visible' } };
});
