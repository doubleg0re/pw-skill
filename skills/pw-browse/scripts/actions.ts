// actions.ts — Shared action implementations used by both CLI scripts and sequence.ts
import type { Page } from 'playwright';
import { screenshotPath } from './common.js';

export async function actionNavigate(page: Page, a: string[]): Promise<{ result?: any }> {
  await page.goto(a[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { result: { url: a[0], title: await page.title() } };
}

export async function actionClick(page: Page, a: string[]): Promise<{ result?: any }> {
  if (/^\d+,\d+$/.test(a[0])) {
    const [x, y] = a[0].split(',').map(Number);
    await page.mouse.click(x, y);
  } else if (a[0].startsWith('#') || a[0].startsWith('.') || a[0].startsWith('[')) {
    await page.locator(a[0]).first().click();
  } else {
    await page.getByText(a[0], { exact: false }).first().click();
  }
  return {};
}

export async function actionDblclick(page: Page, a: string[]): Promise<{ result?: any }> {
  if (/^\d+,\d+$/.test(a[0])) {
    const [x, y] = a[0].split(',').map(Number);
    await page.mouse.dblclick(x, y);
  } else {
    await page.locator(a[0]).first().dblclick();
  }
  return {};
}

export async function actionDrag(page: Page, a: string[]): Promise<{ result?: any }> {
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
  return {};
}

export async function actionFill(page: Page, a: string[]): Promise<{ result?: any }> {
  await page.locator(a[0]).first().click();
  await page.locator(a[0]).first().fill(a[1]);
  return {};
}

export async function actionType(page: Page, a: string[]): Promise<{ result?: any }> {
  await page.keyboard.type(a[0], { delay: a[1] ? parseInt(a[1]) : 0 });
  return {};
}

export async function actionWait(page: Page, a: string[]): Promise<{ result?: any }> {
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(a[0])) {
    const [h, m, s] = a[0].split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, s || 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const ms = target.getTime() - now.getTime();
    await new Promise(resolve => setTimeout(resolve, ms));
  } else if (a[0].startsWith('http') || a[0].startsWith('/')) {
    await page.waitForURL(a[0].includes('*') ? a[0] : `**${a[0]}*`, { timeout: 30000 });
  } else if (/^\d+$/.test(a[0])) {
    await new Promise(resolve => setTimeout(resolve, parseInt(a[0])));
  } else if (a[1] && a[2]) {
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
  return {};
}

export async function actionHover(page: Page, a: string[]): Promise<{ result?: any }> {
  if (/^\d+,\d+$/.test(a[0])) {
    const [x, y] = a[0].split(',').map(Number);
    await page.mouse.move(x, y);
  } else {
    await page.locator(a[0]).first().hover();
  }
  return {};
}

export async function actionScroll(page: Page, a: string[]): Promise<{ result?: any }> {
  if (a[0] === 'down') await page.evaluate((px) => window.scrollBy(0, px || window.innerHeight), a[1] ? parseInt(a[1]) : undefined);
  else if (a[0] === 'up') await page.evaluate((px) => window.scrollBy(0, -(px || window.innerHeight)), a[1] ? parseInt(a[1]) : undefined);
  else if (a[0] === 'top') await page.evaluate(() => window.scrollTo(0, 0));
  else if (a[0] === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  else await page.locator(a[0]).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  return {};
}

export async function actionSelect(page: Page, a: string[]): Promise<{ result?: any }> {
  if (a[2] === 'label') await page.locator(a[0]).first().selectOption({ label: a[1] });
  else if (a[2] === 'index') await page.locator(a[0]).first().selectOption({ index: parseInt(a[1]) });
  else await page.locator(a[0]).first().selectOption({ value: a[1] });
  return {};
}

export async function actionUpload(page: Page, a: string[]): Promise<{ result?: any }> {
  await page.locator(a[0]).first().setInputFiles(a.slice(1));
  return {};
}

export async function actionAttr(page: Page, a: string[]): Promise<{ result?: any }> {
  if (a[2]) {
    await page.locator(a[0]).first().evaluate((el, { name, value }) => {
      if (name === 'textContent') el.textContent = value;
      else if (name === 'value') (el as HTMLInputElement).value = value;
      else el.setAttribute(name, value);
    }, { name: a[1], value: a[2] });
    return {};
  }
  const val = await page.locator(a[0]).first().evaluate((el, name) => {
    if (name === 'textContent') return el.textContent?.trim();
    if (name === 'value') return (el as HTMLInputElement).value;
    return el.getAttribute(name);
  }, a[1]);
  return { result: val };
}

export async function actionSubmit(page: Page, a: string[]): Promise<{ result?: any }> {
  if (a[0]) await page.locator(a[0]).first().evaluate((form: HTMLFormElement) => form.submit());
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  return {};
}

export async function actionFetch(page: Page, a: string[]): Promise<{ result?: any }> {
  const method = (a[0] || 'GET').toUpperCase();
  const rawUrl = a[1];
  const fetchBody = a[2];

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
      if (body && method !== 'GET') opts.body = body;
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

export async function actionScreenshot(page: Page, a: string[]): Promise<{ result?: any }> {
  const last = a[a.length - 1];
  const hasName = a.length >= 2 && last && last !== 'full' && !/^\d+,\d+,\d+,\d+$/.test(last) && !last.startsWith('#') && !last.startsWith('.') && !last.startsWith('[');
  const name = hasName ? last : undefined;
  const target = hasName ? a[0] : a[0];
  const path = screenshotPath(name);
  if (target === 'full') {
    await page.screenshot({ path, fullPage: true });
  } else if (target && /^\d+,\d+,\d+,\d+$/.test(target)) {
    const [x, y, width, height] = target.split(',').map(Number);
    await page.screenshot({ path, clip: { x, y, width, height } });
  } else if (target) {
    await page.locator(target).first().screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
  return { result: { screenshot: path } };
}

export async function actionEvaluate(page: Page, a: string[]): Promise<{ result?: any }> {
  const evalResult = await page.evaluate(a[0]);
  return { result: evalResult };
}

/** Map of action names to their implementations */
export const ACTION_MAP: Record<string, (page: Page, a: string[]) => Promise<{ result?: any }>> = {
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
