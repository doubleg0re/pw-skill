// actions.ts — Shared action implementations used by both CLI scripts and sequence.ts
import type { Page } from 'playwright';
import { screenshotPath } from './common.js';
import { headTruncate } from './dump-utils.js';
import { evaluateAssertion, type AssertionType } from './assert-utils.js';

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

export async function actionRefresh(page: Page, _a?: ActionArgs): Promise<{ result?: any }> {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  return { result: { url: page.url(), title: await page.title(), reloaded: true } };
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

export async function actionWait(page: Page, a: ActionArgs, runtime?: any): Promise<{ result?: any }> {
  const target = getArg(a, 'target', 0);
  const attr = getArg(a, 'attr', 1);
  const value = getArg(a, 'value', 2);

  // wait user-action: pause for human intervention (headed only)
  if (target === 'user-action') {
    // Headless guard — user can't interact with overlay in headless mode
    const isHeadless = await page.evaluate(() => !window.outerHeight || !window.outerWidth).catch(() => true);
    if (isHeadless) {
      throw new Error('wait user-action requires --headed (no visible browser window for user interaction)');
    }

    const prompt = (Array.isArray(a) ? a[1] : a.prompt) || 'Complete the action, then click Continue';
    const actions: string[] = (Array.isArray(a) ? undefined : a.actions) || ['continue'];
    const focus = Array.isArray(a) ? undefined : a.focus;
    const idle = Number(Array.isArray(a) ? undefined : a.idle) || 0;

    // Emit user-action:started so extensions can persist state
    if (runtime?.emitEvent) {
      const tabId = runtime.tab?.id ?? 0;
      runtime.emitEvent('user-action:started', {
        session: runtime.session?.name,
        tabId,
        prompt,
        actions,
        focus,
        timestamp: new Date().toISOString(),
      });
    }

    // Focus element if specified
    if (focus) {
      await page.locator(String(focus)).first().click().catch(() => {});
    }

    // Wait for idle period before showing overlay
    if (idle > 0) {
      await new Promise(r => setTimeout(r, idle));
    }

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

    // Emit user-action:completed so extensions can clear state
    if (runtime?.emitEvent) {
      const tabId = runtime.tab?.id ?? 0;
      runtime.emitEvent('user-action:completed', {
        session: runtime.session?.name,
        tabId,
        action: clicked,
        timestamp: new Date().toISOString(),
      });
    }

    return { result: { waited: 'user-action', prompt, action: clicked } };
  }

  // wait user-alert: informational overlay, auto-dismiss on click
  if (target === 'user-alert') {
    const isHeadless = await page.evaluate(() => !window.outerHeight || !window.outerWidth).catch(() => true);
    if (isHeadless) {
      throw new Error('wait user-alert requires --headed (no visible browser window)');
    }
    const prompt = (Array.isArray(a) ? a[1] : a.prompt) || 'Please complete the action.';

    await page.evaluate((promptMsg: string) => {
      const overlay = document.createElement('div');
      overlay.id = '__pw_user_alert_overlay';
      overlay.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#1a1a2e;color:#fff;padding:16px 24px;border-radius:8px;font-family:system-ui;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:320px;cursor:pointer;';
      overlay.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px;">Notice</div>
        <div style="color:#ccc;">${promptMsg}</div>
        <div style="color:#666;font-size:12px;margin-top:8px;">Click to dismiss</div>
      `;
      overlay.addEventListener('click', () => overlay.remove());
      document.body.appendChild(overlay);
    }, prompt);

    // Wait for overlay to be dismissed
    await page.waitForFunction(() => !document.getElementById('__pw_user_alert_overlay'), {}, { timeout: 0 });

    return { result: { waited: 'user-alert', prompt } };
  }

  // Observation wait: dom:<selector>, dom:<selector>[field], url:<pattern>, challenge
  if (typeof target === 'string' && (target.startsWith('dom:') || target.startsWith('url:') || target === 'challenge')) {
    const timeout = Number((Array.isArray(a) ? undefined : a.timeout) || 30000);
    const trigger = Array.isArray(a) ? undefined : a.trigger;

    if (target.startsWith('dom:')) {
      const domPart = target.slice(4); // after "dom:"
      const fieldMatch = domPart.match(/^(.+)\[(\w+)\]$/);
      const selector = fieldMatch ? fieldMatch[1] : domPart;
      const field = fieldMatch ? fieldMatch[2] : null;

      // Get initial value
      const initial = await page.evaluate(({ sel, field }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (field) {
          if (field === 'textContent') return el.textContent?.trim();
          if (field === 'value') return (el as HTMLInputElement).value;
          return el.getAttribute(field);
        }
        return el.outerHTML;
      }, { sel: selector, field }).catch(() => null);

      // Poll for change + evaluate trigger if provided
      const result = await page.waitForFunction(({ sel, field, initial, triggerDef }) => {
        const el = document.querySelector(sel);
        if (!el) return initial !== null ? { changed: true, current: null } : null;
        let current: any;
        if (field) {
          if (field === 'textContent') current = el.textContent?.trim();
          else if (field === 'value') current = (el as HTMLInputElement).value;
          else current = el.getAttribute(field);
        } else {
          current = el.outerHTML;
        }

        const changed = current !== initial;

        // If trigger is defined, evaluate it against $changed/$current
        if (triggerDef && changed) {
          // Simple in-browser trigger evaluation
          const evalLeaf = (node: any, vars: Record<string, any>): boolean => {
            if (node.and) return node.and.every((c: any) => evalLeaf(c, vars));
            if (node.or) return node.or.some((c: any) => evalLeaf(c, vars));
            const ref = node.ref;
            const val = ref?.startsWith('$') ? vars[ref] : undefined;
            if ('eq' in node) return val == node.eq;
            if ('neq' in node) return val != node.neq;
            if ('contains' in node) return String(val ?? '').includes(String(node.contains));
            if ('exists' in node) return node.exists ? val != null : val == null;
            return false;
          };
          const vars = { $changed: changed, $current: current, $previous: initial };
          if (!evalLeaf(triggerDef, vars)) return null; // trigger not satisfied yet
        }

        if (changed) return { changed: true, current };
        return null;
      }, { sel: selector, field, initial, triggerDef: trigger || null }, { timeout });

      const data = await result.jsonValue() as any;

      return {
        result: {
          target,
          changed: true,
          selector,
          ...(field ? { field } : {}),
          previous: initial,
          current: data?.current,
        },
      };
    }

    if (target.startsWith('url:')) {
      const pattern = target.slice(4);
      const initialUrl = page.url();

      await page.waitForURL(pattern.includes('*') ? pattern : `**${pattern}*`, { timeout });

      return {
        result: {
          target,
          changed: true,
          previous: initialUrl,
          current: page.url(),
        },
      };
    }

    if (target === 'challenge') {
      // Poll for challenge indicators
      const result = await page.waitForFunction(() => {
        const body = document.body?.innerHTML || '';
        const isCf = body.includes('cf-challenge') || body.includes('challenge-platform');
        const isRecaptcha = !!document.querySelector('.g-recaptcha, [data-sitekey]');
        if (isCf || isRecaptcha) {
          return { detected: true, type: isCf ? 'cloudflare' : 'recaptcha' };
        }
        return null;
      }, {}, { timeout });

      const data = await result.jsonValue() as any;

      return {
        result: {
          target: 'challenge',
          changed: true,
          detected: data?.detected || false,
          type: data?.type || 'unknown',
        },
      };
    }
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
  let value = getArg(a, 'value', 1);
  let mode = getArg(a, 'mode', 2);

  if (!Array.isArray(a)) {
    if (a.label !== undefined && a.label !== false) {
      mode = 'label';
      value = a.label === true ? (a[1] ?? value) : a.label;
    } else if (a.index !== undefined && a.index !== false) {
      mode = 'index';
      value = a.index === true ? (a[1] ?? value) : a.index;
    } else if (a.value !== undefined && a.value !== false) {
      mode = 'value';
      value = a.value === true ? (a[1] ?? value) : a.value;
    }
  }

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

export async function actionScreenshot(page: Page, a: ActionArgs, runtime?: any): Promise<{ result?: any }> {
  const name = getArg(a, 'name', 1) || getArg(a, 'filename', 1);
  const target = getArg(a, 'selector', 0) || getArg(a, 'target', 0);
  const path = screenshotPath(name, runtime?.session);

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

const ASSERT_POLL_INTERVAL = 100;

export async function actionAssert(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (!selector) throw new Error('Missing selector for assert action');

  const isExists = Array.isArray(a) ? a.includes('exists') : !!a.exists;
  const textVal = Array.isArray(a) ? undefined : a.text;
  const containsVal = Array.isArray(a) ? undefined : a.contains;
  const attrName = Array.isArray(a) ? undefined : a.attr;
  const attrValue = Array.isArray(a) ? undefined : a.value;
  const waitMs = Number(Array.isArray(a) ? undefined : a.wait) || 0;

  let type: AssertionType;
  let expected: string | undefined;

  if (isExists) {
    type = 'exists';
  } else if (textVal !== undefined) {
    type = 'text';
    expected = String(textVal);
  } else if (containsVal !== undefined) {
    type = 'contains';
    expected = String(containsVal);
  } else if (attrName !== undefined) {
    type = 'attr';
    expected = attrValue !== undefined ? String(attrValue) : undefined;
  } else {
    throw new Error('Missing assertion type for assert action. Use exists, text, contains, or attr.');
  }

  async function evaluate() {
    const elementExists = await page.locator(selector).count().then(c => c > 0);

    let actualText: string | undefined;
    let actualAttrValue: string | undefined;

    if (elementExists && (type === 'text' || type === 'contains')) {
      actualText = await page.locator(selector).first().evaluate(
        (el) => (el as HTMLElement).innerText,
      );
    }

    if (elementExists && type === 'attr' && attrName) {
      actualAttrValue = await page.locator(selector).first().evaluate(
        (el, name) => el.getAttribute(name),
        String(attrName),
      ).then(v => v ?? undefined);
    }

    return evaluateAssertion({ type, expected }, selector, elementExists, actualText, actualAttrValue);
  }

  if (!waitMs) {
    const assertionResult = await evaluate();
    return { result: assertionResult };
  }

  const start = Date.now();
  let attempts = 0;
  let lastResult = await evaluate();
  attempts++;

  while (!lastResult.passed && (Date.now() - start) < waitMs) {
    await new Promise(r => setTimeout(r, ASSERT_POLL_INTERVAL));
    lastResult = await evaluate();
    attempts++;
  }

  const elapsedMs = Date.now() - start;

  return {
    result: {
      ...lastResult,
      waitMs,
      elapsedMs,
      attempts,
    },
  };
}

/** Map of action names to their implementations */
export async function actionDump(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = Array.isArray(a) ? a[0] : a.selector;
  const isText = Array.isArray(a) ? a.includes('text') : !!a.text;
  const isBody = Array.isArray(a) ? a.includes('body') : !!a.body;
  const savePath = Array.isArray(a) ? undefined : a.save;
  const doReplace = Array.isArray(a) ? false : !!a.replace;
  const doAppend = Array.isArray(a) ? false : !!a.append;
  const headN = Array.isArray(a) ? undefined : (a.head !== undefined ? Number(a.head) : undefined);

  // Validate --head flag
  if (headN !== undefined && (isNaN(headN) || headN < 0)) {
    throw new Error('head must be a non-negative integer.');
  }

  // Validate save flags
  if (doReplace && doAppend) throw new Error('Cannot use replace and append together.');
  if ((doReplace || doAppend) && !savePath) throw new Error('replace/append requires save.');

  let target: string;
  let format: 'html' | 'text';
  let content: string;

  if (selector) {
    const count = await page.locator(selector).count();
    if (count === 0) throw new Error(`No element matched selector: ${selector}`);

    target = `selector:${selector}`;
    if (isText) {
      format = 'text';
      content = (await page.locator(selector).first().textContent())?.trim() || '';
    } else {
      format = 'html';
      content = await page.locator(selector).first().evaluate(el => el.outerHTML);
    }
  } else if (isText) {
    target = isBody ? 'body' : 'document';
    format = 'text';
    content = await page.evaluate((body: boolean) =>
      body ? (document.body?.textContent?.trim() || '') : (document.documentElement?.textContent?.trim() || ''),
      isBody,
    );
  } else {
    target = isBody ? 'body' : 'document';
    format = 'html';
    content = await page.evaluate((body: boolean) =>
      body ? (document.body?.outerHTML || '') : (document.documentElement?.outerHTML || ''),
      isBody,
    );
  }

  // File save
  let filePath: string | undefined;
  let mode: 'write' | 'replace' | 'append' = 'write';

  if (savePath) {
    const { resolve, extname } = await import('path');
    const { existsSync, writeFileSync, appendFileSync } = await import('fs');
    filePath = resolve(String(savePath));
    if (!extname(filePath)) filePath += format === 'text' ? '.txt' : '.html';

    if (existsSync(filePath)) {
      if (doReplace) mode = 'replace';
      else if (doAppend) mode = 'append';
      else throw new Error(`File already exists: ${filePath}\nUse replace or append to overwrite.`);
    }

    if (mode === 'append') appendFileSync(filePath, content);
    else writeFileSync(filePath, content);
  }

  // Apply head truncation (only to returned content, not saved files)
  let truncated = false;
  let head: number | undefined;
  let originalLength: number | undefined;

  if (headN !== undefined) {
    const result = headTruncate(content, headN);
    content = result.content;
    truncated = result.truncated;
    head = result.head;
    originalLength = result.originalLength;
  }

  return {
    result: {
      target,
      format,
      content,
      ...(truncated ? { truncated: true } : {}),
      ...(head !== undefined ? { head } : {}),
      ...(originalLength !== undefined ? { originalLength } : {}),
      ...(filePath ? { path: filePath, mode } : {}),
    },
  };
}

export const ACTION_MAP: Record<string, (page: Page, a: ActionArgs) => Promise<{ result?: any }>> = {
  navigate: actionNavigate,
  nav: actionNavigate,
  refresh: actionRefresh,
  reload: actionRefresh,
  click: actionClick,
  dblclick: actionDblclick,
  drag: actionDrag,
  fill: actionFill,
  type: actionType,
  wait: actionWait,
  hover: actionHover,
  scroll: actionScroll,
  select: actionSelect,
  sel: actionSelect,
  upload: actionUpload,
  attr: actionAttr,
  submit: actionSubmit,
  fetch: actionFetch,
  screenshot: actionScreenshot,
  shot: actionScreenshot,
  evaluate: actionEvaluate,
  eval: actionEvaluate,
  dump: actionDump,
  assert: actionAssert,
};
