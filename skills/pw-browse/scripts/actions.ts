// actions.ts — Shared action implementations used by both CLI scripts and sequence.ts
import type { Page } from 'playwright';
import { screenshotPath } from './common.js';

/** Flexible argument type for actions */
export type ActionArgs = string[] | Record<string, any>;

/** Helper to get argument by name or index */
function getArg(a: ActionArgs, name: string, index: number): any {
  if (Array.isArray(a)) return a[index];
  return a[name] ?? a[index]; // fallback to index if name not found
}

export async function actionNavigate(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const url = getArg(a, 'url', 0);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { result: { url, title: await page.title() } };
}

export async function actionClick(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (/^\d+,\d+$/.test(selector)) {
    const [x, y] = selector.split(',').map(Number);
    await page.mouse.click(x, y);
  } else if (selector.startsWith('#') || selector.startsWith('.') || selector.startsWith('[')) {
    await page.locator(selector).first().click();
  } else {
    await page.getByText(selector, { exact: false }).first().click();
  }
  return {};
}

export async function actionDblclick(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (/^\d+,\d+$/.test(selector)) {
    const [x, y] = selector.split(',').map(Number);
    await page.mouse.dblclick(x, y);
  } else {
    await page.locator(selector).first().dblclick();
  }
  return {};
}

export async function actionDrag(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const source = getArg(a, 'source', 0);
  const target = getArg(a, 'target', 1);

  if (/^\d+,\d+$/.test(source) && /^\d+,\d+$/.test(target)) {
    const [sx, sy] = source.split(',').map(Number);
    const [tx, ty] = target.split(',').map(Number);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.up();
  } else {
    await page.locator(source).first().dragTo(page.locator(target).first());
  }
  return {};
}

export async function actionFill(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  const value = getArg(a, 'value', 1);
  await page.locator(selector).first().click();
  await page.locator(selector).first().fill(String(value));
  return {};
}

export async function actionType(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const text = getArg(a, 'text', 0);
  const delay = Number(getArg(a, 'delay', 1) || 0);
  await page.keyboard.type(String(text), { delay });
  return {};
}

export async function actionWait(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const target = getArg(a, 'target', 0);
  const attr = getArg(a, 'attr', 1);
  const value = getArg(a, 'value', 2);

  // wait user-action: pause for human intervention (headed only)
  if (target === 'user-action') {
    const prompt = (Array.isArray(a) ? a[1] : a.prompt) || 'Complete the action, then click Continue';
    const actions: string[] = (Array.isArray(a) ? undefined : a.actions) || ['continue'];

    // Inject overlay with action buttons
    await page.evaluate(({ promptMsg, btns }: { promptMsg: string; btns: string[] }) => {
      const overlay = document.createElement('div');
      overlay.id = '__pw_user_action_overlay';
      overlay.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#1a1a2e;color:#fff;padding:16px 24px;border-radius:8px;font-family:system-ui;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:400px;';

      const buttonsHtml = btns.map(b =>
        `<button class="__pw_action_btn" data-action="${b}" style="background:#4f46e5;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:14px;margin-right:8px;">${b}</button>`
      ).join('');

      overlay.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px;">Waiting for user action</div>
        <div style="color:#ccc;margin-bottom:12px;">${promptMsg}</div>
        <div>${buttonsHtml}</div>
      `;
      document.body.appendChild(overlay);
    }, { promptMsg: prompt, btns: actions });

    // Wait for any action button click
    const clicked = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        document.querySelectorAll('.__pw_action_btn').forEach(btn => {
          btn.addEventListener('click', () => {
            resolve((btn as HTMLElement).dataset.action || 'continue');
          });
        });
      });
    });

    // Remove overlay
    await page.evaluate(() => {
      document.getElementById('__pw_user_action_overlay')?.remove();
    });

    return { result: { waited: 'user-action', prompt, action: clicked } };
  }

  if (typeof target === 'number' || /^\d+$/.test(target)) {
    await new Promise(resolve => setTimeout(resolve, Number(target)));
  } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(target)) {
    const [h, m, s] = target.split(':').map(Number);
    const now = new Date();
    const targetTime = new Date(now);
    targetTime.setHours(h, m, s || 0, 0);
    if (targetTime <= now) targetTime.setDate(targetTime.getDate() + 1);
    const ms = targetTime.getTime() - now.getTime();
    await new Promise(resolve => setTimeout(resolve, ms));
  } else if (target.startsWith('http') || target.startsWith('/')) {
    await page.waitForURL(target.includes('*') ? target : `**${target}*`, { timeout: 30000 });
  } else if (attr && value !== undefined) {
    await page.waitForFunction(
      ({ sel, attr, value }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const actual = attr === 'textContent' ? el.textContent?.trim()
          : attr === 'innerText' ? (el as HTMLElement).innerText?.trim()
          : (el as HTMLElement).getAttribute(attr);
        return actual === String(value);
      },
      { sel: target, attr, value },
      { timeout: 30000 },
    );
  } else {
    await page.locator(target).first().waitFor({ state: 'visible', timeout: 30000 });
  }
  return {};
}

export async function actionHover(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (/^\d+,\d+$/.test(selector)) {
    const [x, y] = selector.split(',').map(Number);
    await page.mouse.move(x, y);
  } else {
    await page.locator(selector).first().hover();
  }
  return {};
}

export async function actionScroll(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const direction = getArg(a, 'direction', 0);
  const amount = getArg(a, 'amount', 1);

  if (direction === 'down') await page.evaluate((px) => window.scrollBy(0, px || window.innerHeight), amount ? Number(amount) : undefined);
  else if (direction === 'up') await page.evaluate((px) => window.scrollBy(0, -(px || window.innerHeight)), amount ? Number(amount) : undefined);
  else if (direction === 'top') await page.evaluate(() => window.scrollTo(0, 0));
  else if (direction === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  else await page.locator(direction).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  return {};
}

export async function actionSelect(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  const value = getArg(a, 'value', 1);
  const mode = getArg(a, 'mode', 2);

  if (mode === 'label') await page.locator(selector).first().selectOption({ label: String(value) });
  else if (mode === 'index') await page.locator(selector).first().selectOption({ index: Number(value) });
  else await page.locator(selector).first().selectOption({ value: String(value) });
  return {};
}

export async function actionUpload(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  const files = Array.isArray(a) ? a.slice(1) : (Array.isArray(a.files) ? a.files : [a.files]);
  await page.locator(selector).first().setInputFiles(files);
  return {};
}

export async function actionAttr(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  const name = getArg(a, 'name', 1);
  const value = getArg(a, 'value', 2);

  if (value !== undefined) {
    await page.locator(selector).first().evaluate((el, { name, value }) => {
      if (name === 'textContent') el.textContent = value;
      else if (name === 'value') (el as HTMLInputElement).value = value;
      else el.setAttribute(name, value);
    }, { name, value: String(value) });
    return {};
  }
  const val = await page.locator(selector).first().evaluate((el, name) => {
    if (name === 'textContent') return el.textContent?.trim();
    if (name === 'value') return (el as HTMLInputElement).value;
    return el.getAttribute(name);
  }, name);
  return { result: val };
}

export async function actionSubmit(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (selector) await page.locator(selector).first().evaluate((form: HTMLFormElement) => form.submit());
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  return {};
}

export async function actionFetch(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const method = String(getArg(a, 'method', 0) || 'GET').toUpperCase();
  const rawUrl = getArg(a, 'url', 1);
  const fetchBody = getArg(a, 'body', 2);

  // Resolve relative URLs against the current page origin
  const fetchUrl = rawUrl.startsWith('http')
    ? rawUrl
    : await page.evaluate((path) => {
        const origin = window.location.origin;
        if (!origin || origin === 'null') throw new Error(`Cannot resolve relative URL "${path}" — no page loaded (current: ${window.location.href})`);
        return new URL(path, origin).href;
      }, rawUrl);

  const fetchResult = await page.evaluate(
    async ({ method, url, body }) => {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
      if (body && method !== 'GET') opts.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      const res = await fetch(url, opts);
      const contentType = res.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('json')) data = await res.json();
      else {
        data = await res.text();
        if (data.length > 2000) data = data.substring(0, 2000) + '...(truncated)';
      }
      return { status: res.status, statusText: res.statusText, data };
    },
    { method, url: fetchUrl, body: fetchBody },
  );
  return { result: fetchResult };
}

export async function actionScreenshot(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const name = getArg(a, 'name', 1) || getArg(a, 'filename', 1);
  const target = getArg(a, 'selector', 0) || getArg(a, 'target', 0);
  const path = screenshotPath(name);

  if (target === 'full') {
    await page.screenshot({ path, fullPage: true });
  } else if (target && String(target).match(/^\d+,\d+,\d+,\d+$/)) {
    const [x, y, width, height] = String(target).split(',').map(Number);
    await page.screenshot({ path, clip: { x, y, width, height } });
  } else if (target) {
    await page.locator(target).first().screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
  return { result: { screenshot: path } };
}

export async function actionEvaluate(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const expression = getArg(a, 'expression', 0) || getArg(a, 'js', 0);
  const evalResult = await page.evaluate(expression);
  return { result: evalResult };
}

/** Map of action names to their implementations */
export const ACTION_MAP: Record<string, (page: Page, a: ActionArgs) => Promise<{ result?: any }>> = {
  navigate: actionNavigate,
  click: actionClick,
  dblclick: actionDblclick,
  drag: actionDrag,
  fill: actionFill,
  type: actionType,
  wait: actionWait,
  hover: actionHover,
  scroll: actionScroll,
  select: actionSelect,
  upload: actionUpload,
  attr: actionAttr,
  submit: actionSubmit,
  fetch: actionFetch,
  screenshot: actionScreenshot,
  evaluate: actionEvaluate,
};
