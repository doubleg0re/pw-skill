// sequence.ts — JSON 기반 액션 시퀀스 실행
// Usage:
//   pw sequence '[{"action":"navigate","args":["http://localhost:3000"]},{"action":"click","args":["#login"]},{"action":"fill","args":["#email","test@test.com"]},{"action":"wait","args":["#dashboard"]}]'
//   pw sequence ./scripts/playwright/login-flow.json
import { run, screenshotPath } from './common.js';
import { existsSync, readFileSync } from 'fs';

interface Step {
  action: string;
  args?: string[];
}

run(async ({ page, args: cliArgs }) => {
  const input = cliArgs[0];
  if (!input) return { success: false, error: 'Usage: sequence.ts <json-string | json-file-path>' };

  // JSON 파일 또는 인라인 JSON
  let steps: Step[];
  try {
    if (existsSync(input)) {
      steps = JSON.parse(readFileSync(input, 'utf-8'));
    } else {
      steps = JSON.parse(input);
    }
  } catch {
    return { success: false, error: 'Invalid JSON. Provide a JSON array or a path to a JSON file.' };
  }

  if (!Array.isArray(steps)) return { success: false, error: 'JSON must be an array of steps.' };

  const results: { step: number; action: string; success: boolean; error?: string }[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const a = step.args || [];
    try {
      switch (step.action) {
        case 'navigate':
          await page.goto(a[0], { waitUntil: 'networkidle', timeout: 30000 });
          break;

        case 'click':
          if (/^\d+,\d+$/.test(a[0])) {
            const [x, y] = a[0].split(',').map(Number);
            await page.mouse.click(x, y);
          } else if (a[0].startsWith('#') || a[0].startsWith('.') || a[0].startsWith('[')) {
            await page.locator(a[0]).first().click();
          } else {
            await page.getByText(a[0], { exact: false }).first().click();
          }
          break;

        case 'dblclick':
          if (/^\d+,\d+$/.test(a[0])) {
            const [x, y] = a[0].split(',').map(Number);
            await page.mouse.dblclick(x, y);
          } else {
            await page.locator(a[0]).first().dblclick();
          }
          break;

        case 'drag':
          if (/^\d+,\d+$/.test(a[0]) && /^\d+,\d+$/.test(a[1])) {
            const [sx, sy] = a[0].split(',').map(Number);
            const [tx, ty] = a[1].split(',').map(Number);
            await page.mouse.move(sx, sy);
            await page.mouse.down();
            await page.mouse.move(tx, ty, { steps: 10 });
            await page.mouse.up();
          } else {
            await page.locator(a[0]).first().dragTo(page.locator(a[1]).first());
          }
          break;

        case 'fill':
          await page.locator(a[0]).first().click();
          await page.locator(a[0]).first().fill(a[1]);
          break;

        case 'type':
          await page.keyboard.type(a[0], { delay: a[1] ? parseInt(a[1]) : 0 });
          break;

        case 'wait':
          if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(a[0])) {
            // 특정 시각까지 대기: "14:30" 또는 "14:30:00"
            const [h, m, s] = a[0].split(':').map(Number);
            const now = new Date();
            const target = new Date(now);
            target.setHours(h, m, s || 0, 0);
            if (target <= now) target.setDate(target.getDate() + 1); // 이미 지났으면 내일
            const ms = target.getTime() - now.getTime();
            await new Promise(resolve => setTimeout(resolve, ms));
          } else if (a[0].startsWith('http') || a[0].startsWith('/')) {
            await page.waitForURL(a[0].includes('*') ? a[0] : `**${a[0]}*`, { timeout: 30000 });
          } else if (/^\d+$/.test(a[0])) {
            await new Promise(resolve => setTimeout(resolve, parseInt(a[0])));
          } else if (a[1] && a[2]) {
            // wait selector attr value
            await page.waitForFunction(
              ({ sel, attr, value }) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const actual = attr === 'textContent' ? el.textContent?.trim()
                  : attr === 'innerText' ? (el as HTMLElement).innerText?.trim()
                  : (el as HTMLElement).getAttribute(attr);
                return actual === value;
              },
              { sel: a[0], attr: a[1], value: a[2] },
              { timeout: 30000 },
            );
          } else {
            await page.locator(a[0]).first().waitFor({ state: 'visible', timeout: 30000 });
          }
          break;

        case 'hover':
          if (/^\d+,\d+$/.test(a[0])) {
            const [x, y] = a[0].split(',').map(Number);
            await page.mouse.move(x, y);
          } else {
            await page.locator(a[0]).first().hover();
          }
          break;

        case 'scroll':
          if (a[0] === 'down') await page.evaluate((px) => window.scrollBy(0, px || window.innerHeight), a[1] ? parseInt(a[1]) : undefined);
          else if (a[0] === 'up') await page.evaluate((px) => window.scrollBy(0, -(px || window.innerHeight)), a[1] ? parseInt(a[1]) : undefined);
          else if (a[0] === 'top') await page.evaluate(() => window.scrollTo(0, 0));
          else if (a[0] === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          else await page.locator(a[0]).first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          break;

        case 'select':
          if (a[2] === 'label') await page.locator(a[0]).first().selectOption({ label: a[1] });
          else if (a[2] === 'index') await page.locator(a[0]).first().selectOption({ index: parseInt(a[1]) });
          else await page.locator(a[0]).first().selectOption({ value: a[1] });
          break;

        case 'upload':
          await page.locator(a[0]).first().setInputFiles(a.slice(1));
          break;

        case 'attr':
          if (a[2]) {
            await page.locator(a[0]).first().evaluate((el, { name, value }) => {
              if (name === 'textContent') el.textContent = value;
              else if (name === 'value') (el as HTMLInputElement).value = value;
              else el.setAttribute(name, value);
            }, { name: a[1], value: a[2] });
          }
          break;

        case 'submit':
          if (a[0]) await page.locator(a[0]).first().evaluate((form: HTMLFormElement) => form.submit());
          else await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
          break;

        case 'fetch': {
          const method = (a[0] || 'GET').toUpperCase();
          const fetchUrl = a[1];
          const fetchBody = a[2];
          await page.evaluate(
            async ({ method, url, body }) => {
              const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
              if (body && method !== 'GET') opts.body = body;
              await fetch(url, opts);
            },
            { method, url: fetchUrl, body: fetchBody },
          );
          break;
        }

        case 'screenshot':
          const path = screenshotPath();
          await page.screenshot({ path, fullPage: a[0] === 'full' });
          break;

        case 'evaluate':
          await page.evaluate(a[0]);
          break;

        default:
          results.push({ step: i, action: step.action, success: false, error: `Unknown action: ${step.action}` });
          continue;
      }
      results.push({ step: i, action: step.action, success: true });
    } catch (err) {
      results.push({ step: i, action: step.action, success: false, error: err instanceof Error ? err.message : String(err) });
      // 실패 시 중단
      const path = screenshotPath('sequence-error');
      await page.screenshot({ path });
      return {
        success: false,
        screenshot: path,
        data: { completed: i, total: steps.length, results },
        error: `Step ${i} (${step.action}) failed`,
      };
    }
  }

  const path = screenshotPath('sequence-done');
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { completed: steps.length, results } };
});
