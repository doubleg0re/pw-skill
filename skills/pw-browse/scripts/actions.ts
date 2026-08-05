// actions.ts — Shared action implementations used by both CLI scripts and sequence.ts
import type { Locator, Page } from 'playwright';
import { mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { parseSizeSpec, screenshotPath } from './common.js';
import { applyViewportMode, resizeBrowserWindow } from './viewport-utils.js';
import { parsePngSize, isDegenerateCapture } from './screenshot-quality.js';
import { describeCandidates, isCoordinatePair, resolveClickTarget, type TargetMode } from './selector-utils.js';
import { normalizeKey } from './key-utils.js';
import { isSafeMode, isSchemeAllowed, assertAllowedInSafeMode, isPathWithinRoot } from './safe-mode.js';
import {
  ANCHOR_NAMES,
  CENTER_GRIP,
  gripToAbsolute,
  gripToPosition,
  isNonCenter,
  parseGrip,
  parseViewportPoint,
  type Grip,
} from './drag-utils.js';

/** Typed runtime context for actions — replaces `runtime?: ActionRuntime` */
export interface ActionRuntime {
  session?: {
    name: string;
    id?: string;
    pid?: number;
    cdpEndpoint?: string;
  };
  tab?: {
    id?: number;
    url?: string;
    title?: string;
  };
  emitEvent?: (event: string, payload: any) => void;
  logger?: {
    debug?(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  getPage?: () => Promise<any>;
  registerCleanup?: (fn: () => Promise<void> | void) => void;
}
import { headTruncate } from './dump-utils.js';
import { evaluateAssertion, type AssertionType } from './assert-utils.js';
import { createElementRegistry, resolveElementKey } from './element-registry.js';
import { normalizeAuthHeader, resolveFetchCredentials } from './fetch-utils.js';
import { localStateDir, getSession, getDocumentEpoch } from './session.js';
import { resolveTab } from './tab-registry.js';
import { runConsoleCommand } from './console-runtime.js';
import { runNetworkCommand } from './network-runtime.js';

/** Flexible argument type for actions */
export type ActionArgs = string[] | Record<string, any>;

/** Helper to get argument by name or index */
function getArg(a: ActionArgs, name: string, index: number): any {
  if (Array.isArray(a)) return a[index];
  return a[name] ?? a[index]; // fallback to index if name not found
}

function actionArgsToCliArgs(a: ActionArgs): string[] {
  if (Array.isArray(a)) return a.map(value => String(value));

  const positionals = Object.keys(a)
    .filter(key => /^\d+$/.test(key))
    .sort((lhs, rhs) => Number(lhs) - Number(rhs))
    .map(key => String(a[key]));

  const flags = Object.entries(a)
    .filter(([key]) => !/^\d+$/.test(key))
    .flatMap(([key, value]) => {
      if (value === undefined || value === null || value === false) return [];
      if (value === true) return [`--${key}`];
      return [`--${key}=${String(value)}`];
    });

  return [...positionals, ...flags];
}

function parseCliFlag(args: string[], flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasCliFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

/**
 * Resolve --key to a locator selector, or fall back to normal selector from getArg.
 * Returns { selector, elementKey? } — elementKey is set when --key was used successfully.
 */
async function resolveKeyOrSelector(
  page: Page,
  a: ActionArgs,
  selectorIndex: number,
  runtime?: ActionRuntime,
): Promise<{ selector: string; elementKey?: string }> {
  const key = !Array.isArray(a) ? a.key : undefined;
  if (!key) {
    return { selector: getArg(a, 'selector', selectorIndex) };
  }

  // Determine session info: prefer runtime, fall back to file-based lookup
  let sessionId: string;
  let sessionName: string;
  if (runtime?.session) {
    sessionId = runtime.session.id;
    sessionName = runtime.session.name;
  } else {
    // CLI mode: read bound session from file
    const { getBoundSession } = await import('./session.js');
    const boundName = getBoundSession();
    if (!boundName) throw Object.assign(new Error('No active session for --key resolution'), { errorCode: 'stale_key' });
    const session = getSession(boundName);
    if (!session) throw Object.assign(new Error(`Session "${boundName}" not found`), { errorCode: 'stale_key' });
    sessionId = session.id;
    sessionName = session.name;
  }

  const tabId = (() => {
    if (runtime?.tab?.id !== undefined) return runtime.tab.id;
    const context = page.context();
    const pageIndex = context.pages().indexOf(page);
    const curTab = resolveTab(page.url(), pageIndex >= 0 ? pageIndex : undefined);
    return curTab?.tabId ?? 0;
  })();

  const documentEpoch = getDocumentEpoch(sessionName);
  const registry = createElementRegistry(localStateDir());
  const result = await resolveElementKey(page, key, sessionId, tabId, documentEpoch, registry);

  if (!result.success) {
    const err = new Error(result.error);
    (err as any).errorCode = result.errorCode;
    (err as any).data = result.data;
    throw err;
  }

  return { selector: result.locator!, elementKey: key };
}

export async function actionNavigate(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const url = getArg(a, 'url', 0);
  if (isSafeMode() && !isSchemeAllowed(url)) {
    throw new Error(`Navigation to "${url}" is blocked in safe mode (http/https only). Relaunch pw without safe mode to allow other schemes.`);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { result: { url, title: await page.title() } };
}

export async function actionRefresh(page: Page, _a?: ActionArgs): Promise<{ result?: any }> {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  return { result: { url: page.url(), title: await page.title(), reloaded: true } };
}

export async function actionResize(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const rawSize = String(getArg(a, 'size', 0) ?? getArg(a, 'viewport', 0) ?? '');
  if (!rawSize) {
    throw new Error('Size required. Usage: resize <width>x<height>');
  }

  const size = parseSizeSpec(rawSize);
  if (!size) {
    throw new Error(`Invalid size "${rawSize}". Use <width>x<height> like 1440x900.`);
  }

  await applyViewportMode(page, size);
  const resizedWindow = await resizeBrowserWindow(page, size);

  const metrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    window: { width: window.outerWidth, height: window.outerHeight },
  })).catch(() => undefined);

  return {
    result: {
      requested: `${size.width}x${size.height}`,
      width: size.width,
      height: size.height,
      mode: resizedWindow ? 'window' : 'viewport',
      ...(metrics || {}),
    },
  };
}

/** Shared parsing for click-like actions: positional target plus --mode / --timeout. */
function parseTargetArgs(a: ActionArgs): { target?: string; mode?: TargetMode; timeout?: number } {
  let target: string | undefined;
  let mode: string | undefined;
  let rawTimeout: string | number | undefined;
  let within: string | undefined;
  let exact = false;
  let dblclick = false;

  if (Array.isArray(a)) {
    const positionals: string[] = [];
    for (const token of a) {
      const s = String(token);
      if (s.startsWith('--mode=')) { mode = s.slice('--mode='.length); continue; }
      if (s.startsWith('--timeout=')) { rawTimeout = s.slice('--timeout='.length); continue; }
      if (s.startsWith('--within=')) { within = s.slice('--within='.length); continue; }
      if (s === '--exact') { exact = true; continue; }
      if (s === '--dblclick') { dblclick = true; continue; }
      positionals.push(s);
    }
    target = positionals[0];
  } else {
    target = getArg(a, 'selector', 0) ?? getArg(a, 'target', 0);
    mode = a.mode;
    rawTimeout = a.timeout;
    within = a.within;
    exact = a.exact === true || a.exact === 'true';
    dblclick = a.dblclick === true || a.dblclick === 'true';
  }

  const timeout = rawTimeout === undefined ? undefined : Number(rawTimeout);
  return {
    target,
    mode: mode === 'selector' || mode === 'text' ? mode : undefined,
    timeout: timeout !== undefined && Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    exact,
    within,
    dblclick,
  };
}

/**
 * Run the click and, if it fails, say why it probably failed. A substring text match takes
 * `.first()`, so the usual cause is that a different element matched first and was never
 * clickable — which Playwright reports only as an actionability timeout.
 */
async function clickWithDiagnostics(
  page: Page,
  locator: Locator,
  target: string,
  parsed: { exact?: boolean; within?: string },
  kind: 'click' | 'dblclick',
): Promise<void> {
  try {
    if (kind === 'dblclick') await locator.dblclick();
    else await locator.click();
  } catch (cause) {
    const candidates = await describeCandidates(page, target, parsed);
    if (candidates.length === 0) throw cause;
    throw new Error(
      `${(cause as Error).message.split('\n')[0]}\n` +
      `"${target}" matches ${candidates.length} elements as text and the first was used. ` +
      `Narrow it with --exact, --within=<selector>, or --mode=selector.\nCandidates:\n` +
      candidates.map(c => `  - ${c}`).join('\n'),
    );
  }
}

export async function actionClick(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const { selector, elementKey } = await resolveKeyOrSelector(page, a, 0, runtime);
  const parsed = parseTargetArgs(a);
  // `--dblclick` used to be silently dropped, so it behaved as a single click and made
  // "the double click did nothing" look like an app bug. Honour it as an alias instead.
  const kind = parsed.dblclick ? 'dblclick' : 'click';

  if (elementKey) {
    // Resolved from elementKey — always use locator (may contain >> nth=N)
    const el = page.locator(selector).first();
    if (kind === 'dblclick') await el.dblclick();
    else await el.click();
    return { result: { elementKey, ...(parsed.dblclick ? { dblclick: true } : {}) } };
  }

  const target = parsed.target ?? selector;
  if (isCoordinatePair(target)) {
    const [x, y] = target.split(',').map(Number);
    if (kind === 'dblclick') await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y);
    return {};
  }

  const locator = await resolveClickTarget(page, target, parsed);
  await clickWithDiagnostics(page, locator, target, parsed, kind);
  return parsed.dblclick ? { result: { dblclick: true } } : {};
}

export async function actionDblclick(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const { selector, elementKey } = await resolveKeyOrSelector(page, a, 0, runtime);
  if (elementKey) {
    await page.locator(selector).first().dblclick();
    return { result: { elementKey } };
  }

  const parsed = parseTargetArgs(a);
  const target = parsed.target ?? selector;
  if (isCoordinatePair(target)) {
    const [x, y] = target.split(',').map(Number);
    await page.mouse.dblclick(x, y);
    return {};
  }

  const locator = await resolveClickTarget(page, target, parsed);
  await clickWithDiagnostics(page, locator, target, parsed, 'dblclick');
  return {};
}

/** Parse drag positionals plus --grab/--drop/--steps/--mouse from either arg form. */
function parseDragArgs(a: ActionArgs): {
  source?: string;
  target?: string;
  grab?: string;
  drop?: string;
  steps?: number;
  mouse: boolean;
} {
  if (Array.isArray(a)) {
    const positionals: string[] = [];
    let grab: string | undefined;
    let drop: string | undefined;
    let steps: number | undefined;
    let mouse = false;
    for (const token of a) {
      const s = String(token);
      if (s.startsWith('--grab=')) { grab = s.slice('--grab='.length); continue; }
      if (s.startsWith('--drop=')) { drop = s.slice('--drop='.length); continue; }
      if (s.startsWith('--steps=')) { steps = Number(s.slice('--steps='.length)); continue; }
      if (s === '--mouse') { mouse = true; continue; }
      positionals.push(s);
    }
    return { source: positionals[0], target: positionals[1], grab, drop, steps, mouse };
  }
  return {
    source: getArg(a, 'source', 0),
    target: getArg(a, 'target', 1),
    grab: a.grab,
    drop: a.drop,
    steps: a.steps !== undefined ? Number(a.steps) : undefined,
    mouse: a.mouse === true || a.mouse === 'true',
  };
}

function resolveGrip(spec: string | undefined, flag: string): Grip {
  if (!spec) return CENTER_GRIP;
  const grip = parseGrip(spec);
  if (!grip) {
    throw new Error(`Invalid --${flag} "${spec}". Use an anchor (${ANCHOR_NAMES.join(', ')}) or an x,y pixel offset.`);
  }
  return grip;
}

/** Absolute viewport point for an element side of a drag, gripped at `grip`. */
async function dragElementPoint(page: Page, selector: string, grip: Grip, side: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`drag ${side} "${selector}" has no bounding box (not visible or not attached).`);
  return gripToAbsolute(grip, box);
}

/**
 * Drag from source to target. Each side may be a CSS selector or a viewport
 * coordinate `x,y` (so element↔coordinate mixes work). `--grab`/`--drop` pick the
 * grip point on the respective element (ignored for a coordinate side). Native
 * `dragTo` is used for pure element→element (best for HTML5 DnD); any coordinate
 * or `--mouse` switches to the pointer path.
 */
export async function actionDrag(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const parsed = parseDragArgs(a);
  const { source, target } = parsed;
  if (!source || !target) {
    throw new Error('drag requires <source> and <target>. Usage: drag <source|x,y> <target|x,y> [--grab=<anchor|x,y>] [--drop=<anchor|x,y>] [--steps=n] [--mouse]');
  }

  const sourcePoint = parseViewportPoint(source);
  const targetPoint = parseViewportPoint(target);
  const grabGrip = resolveGrip(parsed.grab, 'grab');
  const dropGrip = resolveGrip(parsed.drop, 'drop');
  const steps = parsed.steps !== undefined && Number.isFinite(parsed.steps) && parsed.steps > 0
    ? Math.floor(parsed.steps)
    : 10;

  const anyCoordinate = !!sourcePoint || !!targetPoint;

  // Pure element→element with default (or explicit) grips and no --mouse: native dragTo.
  if (!anyCoordinate && !parsed.mouse) {
    const sourceLoc = page.locator(source).first();
    const targetLoc = page.locator(target).first();
    const opts: { sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } } = {};
    if (isNonCenter(grabGrip)) {
      const box = await sourceLoc.boundingBox();
      if (!box) throw new Error(`drag source "${source}" has no bounding box (not visible or not attached).`);
      opts.sourcePosition = gripToPosition(grabGrip, box);
    }
    if (isNonCenter(dropGrip)) {
      const box = await targetLoc.boundingBox();
      if (!box) throw new Error(`drag target "${target}" has no bounding box (not visible or not attached).`);
      opts.targetPosition = gripToPosition(dropGrip, box);
    }
    await sourceLoc.dragTo(targetLoc, opts);
    return { result: { mode: 'dragTo', source, target } };
  }

  // Mouse path: resolve each side to an absolute viewport point.
  const from = sourcePoint ?? await dragElementPoint(page, source, grabGrip, 'source');
  const to = targetPoint ?? await dragElementPoint(page, target, dropGrip, 'target');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  return { result: { mode: 'mouse', source, target, steps } };
}

export async function actionFill(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const { selector, elementKey } = await resolveKeyOrSelector(page, a, 0, runtime);
  const value = getArg(a, 'value', 1);
  await page.locator(selector).first().click();
  await page.locator(selector).first().fill(String(value));
  return { result: { ...(elementKey ? { elementKey } : { target: selector }), value: String(value) } };
}

export async function actionType(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const text = getArg(a, 'text', 0);
  const delay = Number(getArg(a, 'delay', 1) || 0);
  await page.keyboard.type(String(text), { delay });
  return {};
}

// `type` sends literal characters, so "Enter" would be typed as five letters. This is the
// path for actual key events — special keys and modifier combos alike.
export async function actionPress(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const raw = getArg(a, 'key', 0);
  const delay = Number(getArg(a, 'delay', 1) || 0);
  const key = normalizeKey(String(raw));
  await page.keyboard.press(key, delay ? { delay } : undefined);
  return { result: { key, ...(String(raw) !== key ? { requested: String(raw) } : {}) } };
}

export async function actionWait(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const target = getArg(a, 'target', 0);
  const attr = getArg(a, 'attr', 1);
  const value = getArg(a, 'value', 2);

  // wait user-action: moved to pw-user-action extension as "pw-user-action" action
  if (target === 'user-action') {
    throw new Error('wait user-action has been moved to the pw-user-action extension. Use {"action": "pw-user-action", "prompt": "...", "actions": [...]} instead.');
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

      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;margin-bottom:8px;';
      title.textContent = 'Notice';
      overlay.appendChild(title);

      const msg = document.createElement('div');
      msg.style.cssText = 'color:#ccc;';
      msg.textContent = promptMsg;
      overlay.appendChild(msg);

      const hint = document.createElement('div');
      hint.style.cssText = 'color:#666;font-size:12px;margin-top:8px;';
      hint.textContent = 'Click to dismiss';
      overlay.appendChild(hint);

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

export async function actionHover(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const { selector, elementKey } = await resolveKeyOrSelector(page, a, 0, runtime);
  if (elementKey) {
    await page.locator(selector).first().hover();
    return { result: { elementKey } };
  }

  const parsed = parseTargetArgs(a);
  const target = parsed.target ?? selector;
  if (isCoordinatePair(target)) {
    const [x, y] = target.split(',').map(Number);
    await page.mouse.move(x, y);
    return {};
  }

  const locator = await resolveClickTarget(page, target, parsed);
  await locator.hover();
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
  if (isSafeMode()) {
    const root = localStateDir();
    for (const f of files) {
      if (!isPathWithinRoot(String(f), root)) throw new Error(`upload source "${f}" is outside the allowed root in safe mode (${root}).`);
    }
  }
  await page.locator(selector).first().setInputFiles(files);
  return {};
}

export async function actionAttr(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const { selector, elementKey } = await resolveKeyOrSelector(page, a, 0, runtime);
  const name = getArg(a, 'name', 1);
  const value = getArg(a, 'value', 2);

  if (value !== undefined) {
    await page.locator(selector).first().evaluate((el, { name, value }) => {
      if (name === 'textContent') el.textContent = value;
      else if (name === 'value') (el as HTMLInputElement).value = value;
      else el.setAttribute(name, value);
    }, { name, value: String(value) });
    return elementKey ? { result: { elementKey } } : {};
  }
  const val = await page.locator(selector).first().evaluate((el, name) => {
    if (name === 'textContent') return el.textContent?.trim();
    if (name === 'value') return (el as HTMLInputElement).value;
    return el.getAttribute(name);
  }, name);
  return { result: elementKey ? { value: val, elementKey } : val };
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
  const auth = normalizeAuthHeader(getArg(a, 'auth', 3));
  const credentials = resolveFetchCredentials(getArg(a, 'credentials', 4));

  // Resolve relative URLs against the current page origin
  const fetchUrl = rawUrl.startsWith('http')
    ? rawUrl
    : await page.evaluate((path) => {
        const origin = window.location.origin;
        if (!origin || origin === 'null') throw new Error(`Cannot resolve relative URL "${path}" — no page loaded (current: ${window.location.href})`);
        return new URL(path, origin).href;
      }, rawUrl);

  const fetchResult = await page.evaluate(
    async ({ method, url, body, authHeader, credentialsMode }) => {
      const opts: RequestInit = { method, credentials: credentialsMode };
      const headers: Record<string, string> = {};
      if (authHeader) headers.Authorization = authHeader;
      if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        opts.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      }
      if (Object.keys(headers).length > 0) opts.headers = headers;
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
    { method, url: fetchUrl, body: fetchBody, authHeader: auth, credentialsMode: credentials },
  );
  return { result: fetchResult };
}

/**
 * Normalize screenshot args across the three entry points so they behave
 * identically: object args (:: chain → { full: true }), array args
 * (seq JSON → ["--full"]), and positional args (CLI → ["full"]).
 */
function parseScreenshotArgs(a: ActionArgs): { target?: string; name?: string; out?: string; full: boolean } {
  let full = false;
  let target: string | undefined;
  let name: string | undefined;
  let out: string | undefined;

  if (Array.isArray(a)) {
    const positionals: string[] = [];
    for (const token of a) {
      const s = String(token);
      if (s === '--full' || s === '--fullPage') { full = true; continue; }
      if (s.startsWith('--out=')) { out = s.slice('--out='.length); continue; }
      if (s.startsWith('--path=')) { out = s.slice('--path='.length); continue; }
      if (s.startsWith('--name=')) { name = s.slice('--name='.length); continue; }
      positionals.push(s);
    }
    target = positionals[0];
    if (name === undefined) name = positionals[1];
  } else {
    target = getArg(a, 'selector', 0) ?? getArg(a, 'target', 0);
    name = getArg(a, 'name', 1) ?? getArg(a, 'filename', 1);
    out = a.out ?? a.path;
    full = a.full === true || a.fullPage === true;
  }

  // Positional "full" sentinel resolves to a full-page capture, not a selector.
  if (target === 'full') { full = true; target = undefined; }

  // A positional that looks like a filesystem path is an output path, not a CSS selector.
  // dump and copy take their path positionally, so accept it here too rather than rejecting.
  if (target && !out && looksLikeOutputPath(target)) { out = target; target = undefined; }

  return { target, name, out, full };
}

/** A positional that looks like a filesystem path is a misplaced output path, not a CSS selector. */
function looksLikeOutputPath(s: string): boolean {
  return /^[/~]/.test(s) || /^\.\.?\//.test(s) || (s.includes('/') && /\.(png|jpe?g|webp|gif)$/i.test(s));
}

export async function actionScreenshot(page: Page, a: ActionArgs, runtime?: ActionRuntime): Promise<{ result?: any }> {
  const parsed = parseScreenshotArgs(a);
  const key = !Array.isArray(a) ? a.key : undefined;
  let target = parsed.target;
  let elementKey: string | undefined;

  // Resolve --key for element screenshot
  if (key && !target) {
    const resolved = await resolveKeyOrSelector(page, a, 0, runtime);
    target = resolved.selector;
    elementKey = resolved.elementKey;
  }

  let path: string;
  if (parsed.out) {
    path = parsed.out;
    mkdirSync(dirname(path), { recursive: true });
  } else {
    path = screenshotPath(parsed.name, runtime?.session);
  }

  const capture = async () => {
    if (parsed.full) {
      await page.screenshot({ path, fullPage: true });
    } else if (target && String(target).match(/^\d+,\d+,\d+,\d+$/)) {
      const [x, y, width, height] = String(target).split(',').map(Number);
      await page.screenshot({ path, clip: { x, y, width, height } });
    } else if (target) {
      await page.locator(target).first().screenshot({ path });
    } else {
      await page.screenshot({ path });
    }
  };

  await capture();
  // Chrome can intermittently return a blank/solid image with correct dimensions
  // and no error. Detect it and retry once before surfacing a warning, so the
  // failure is never silent.
  let quality = inspectCapture(path);
  if (quality.degenerate) {
    await capture();
    quality = inspectCapture(path);
  }

  return {
    result: {
      screenshot: path,
      ...(elementKey ? { elementKey } : {}),
      ...(quality.degenerate ? { warning: quality.reason } : {}),
    },
  };
}

function inspectCapture(path: string): { degenerate: boolean; reason?: string } {
  try {
    const buf = readFileSync(path);
    return isDegenerateCapture(buf.length, parsePngSize(buf));
  } catch {
    return { degenerate: false };
  }
}

export async function actionEvaluate(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  assertAllowedInSafeMode('eval');
  const expression = getArg(a, 'expression', 0) || getArg(a, 'js', 0);
  // With extra args, treat `expression` as a page function and call it with the
  // args passed as *serialized data* (never pasted into the expression source),
  // so parameterized values with quotes/newlines can't break it. A string passed
  // to page.evaluate is an expression and ignores args, so we reconstruct the
  // function in-page and apply the args. No extra args → unchanged bare expression.
  const extra = Array.isArray(a) ? a.slice(1) : (a.arg !== undefined ? [a.arg] : []);
  const evalResult = extra.length === 0
    ? await page.evaluate(expression)
    : await page.evaluate(
        ([fnStr, fnArgs]: [string, any[]]) => (0, eval)('(' + fnStr + ')')(...fnArgs),
        [expression, extra] as [string, any[]],
      );
  return { result: evalResult };
}

import { ASSERT_POLL_INTERVAL_MS as ASSERT_POLL_INTERVAL } from './constants.js';

export async function actionAssert(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const selector = getArg(a, 'selector', 0);
  if (!selector) throw new Error('Missing selector for assert action');

  const isExists = Array.isArray(a) ? a.includes('exists') : !!a.exists;
  const isVisible = Array.isArray(a) ? a.includes('visible') : !!a.visible;
  const isHidden = Array.isArray(a) ? a.includes('hidden') : !!a.hidden;
  const countVal = Array.isArray(a) ? undefined : a.count;
  const textVal = Array.isArray(a) ? undefined : a.text;
  const containsVal = Array.isArray(a) ? undefined : a.contains;
  const attrName = Array.isArray(a) ? undefined : a.attr;
  const attrValue = Array.isArray(a) ? undefined : a.value;
  const waitMs = Number(Array.isArray(a) ? undefined : a.wait) || 0;

  let type: AssertionType;
  let expected: string | undefined;

  if (isExists) {
    type = 'exists';
  } else if (isVisible) {
    type = 'visible';
  } else if (isHidden) {
    type = 'hidden';
  } else if (countVal !== undefined) {
    const n = Number(countVal);
    if (isNaN(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error('count must be a non-negative integer.');
    }
    type = 'count';
    expected = String(countVal);
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
    throw new Error('Missing assertion type for assert action. Use exists, visible, hidden, count, text, contains, or attr.');
  }

  async function evaluate() {
    const loc = page.locator(selector);
    const actualCount = await loc.count();
    const elementExists = actualCount > 0;

    let actualText: string | undefined;
    let actualAttrValue: string | undefined;
    let elemVisible: boolean | undefined;

    if (elementExists && (type === 'text' || type === 'contains')) {
      actualText = await loc.first().evaluate(
        (el) => (el as HTMLElement).innerText,
      );
    }

    if (elementExists && type === 'attr' && attrName) {
      actualAttrValue = await loc.first().evaluate(
        (el, name) => {
          if (name === 'textContent') return el.textContent?.trim();
          if (name === 'innerText') return (el as HTMLElement).innerText?.trim();
          if (name === 'value') return (el as HTMLInputElement).value;
          return el.getAttribute(name);
        },
        String(attrName),
      ).then(v => v ?? undefined);
    }

    if (type === 'visible' || type === 'hidden') {
      elemVisible = elementExists ? await loc.first().isVisible() : false;
    }

    return evaluateAssertion({ type, expected }, selector, elementExists, actualText, actualAttrValue, { isVisible: elemVisible, actualCount });
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

export async function actionConsole(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const cliArgs = actionArgsToCliArgs(a);
  const positionals = cliArgs.filter(arg => !arg.startsWith('--'));
  const rawFilters = Array.isArray(a)
    ? positionals.slice(1) // strip flags before selecting positionals
    : ((a as any).filters || Object.keys(a).filter(k => /^\d+$/.test(k) && Number(k) > 0).sort((x, y) => Number(x) - Number(y)).map(k => String((a as any)[k])));
  // Normalize: string → single-element array
  const filters = typeof rawFilters === 'string' ? [rawFilters] : rawFilters;
  const result = await runConsoleCommand(page, {
    command: getArg(a, 'command', 0) ?? positionals[0],
    filters,
    raw: getArg(a, 'raw', -1) === true || hasCliFlag(cliArgs, 'raw'),
    redactionLevel: getArg(a, 'redactionLevel', -1) || parseCliFlag(cliArgs, 'redaction-level'),
  });
  if (!result.success) {
    throw new Error(result.error || 'console action failed');
  }
  return { result: result.data };
}

export async function actionNetwork(page: Page, a: ActionArgs): Promise<{ result?: any }> {
  const cliArgs = actionArgsToCliArgs(a);
  const positionals = cliArgs.filter(arg => !arg.startsWith('--'));
  const bodyLimitRaw = getArg(a, 'bodyLimit', -1) || parseCliFlag(cliArgs, 'body-limit');
  const bodyLimit = bodyLimitRaw ? (parseInt(String(bodyLimitRaw), 10) || 5000) : undefined;
  const result = await runNetworkCommand(page, {
    command: getArg(a, 'command', 0) ?? positionals[0],
    pattern: getArg(a, 'pattern', 1) ?? positionals[1],
    raw: getArg(a, 'raw', -1) === true || hasCliFlag(cliArgs, 'raw'),
    redactionLevel: getArg(a, 'redactionLevel', -1) || parseCliFlag(cliArgs, 'redaction-level'),
    body: getArg(a, 'body', -1) === true || hasCliFlag(cliArgs, 'body'),
    json: getArg(a, 'json', -1) === true || hasCliFlag(cliArgs, 'json'),
    bodyLimit,
  });
  if (!result.success) {
    throw new Error(result.error || 'network action failed');
  }
  return { result: result.data };
}

export const ACTION_MAP: Record<string, (page: Page, a: ActionArgs, runtime?: ActionRuntime) => Promise<{ result?: any }>> = {
  navigate: actionNavigate,
  nav: actionNavigate,
  refresh: actionRefresh,
  reload: actionRefresh,
  resize: actionResize,
  click: actionClick,
  dblclick: actionDblclick,
  drag: actionDrag,
  fill: actionFill,
  type: actionType,
  press: actionPress,
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
  console: actionConsole,
  network: actionNetwork,
  assert: actionAssert,
};
