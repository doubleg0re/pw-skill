// ~/.claude/skills/pw-browse/scripts/common.ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';

// --- State directory ---

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const STATE_FILE = join(STATE_DIR, 'state.json');
const SCREENSHOTS_DIR = join(STATE_DIR, 'screenshots');
const CDP_PORT_FILE = join(STATE_DIR, 'cdp-port.txt');

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// --- storageState load/save ---

export function loadState(): string | undefined {
  if (existsSync(STATE_FILE)) return STATE_FILE;
  return undefined;
}

export function saveState(context: BrowserContext): Promise<void> {
  ensureStateDir();
  return context.storageState({ path: STATE_FILE });
}

// --- CDP port management ---

function saveCdpPort(port: number): void {
  ensureStateDir();
  writeFileSync(CDP_PORT_FILE, port.toString());
}

function loadCdpPort(): number | undefined {
  if (existsSync(CDP_PORT_FILE)) {
    const port = parseInt(readFileSync(CDP_PORT_FILE, 'utf-8').trim());
    return isNaN(port) ? undefined : port;
  }
  return undefined;
}

function clearCdpPort(): void {
  if (existsSync(CDP_PORT_FILE)) unlinkSync(CDP_PORT_FILE);
}

// --- Chromium CDP process management ---

async function isPortAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function spawnChromium(headless: boolean): Promise<number> {
  const browserPath = chromium.executablePath();
  const userDataDir = join(STATE_DIR, 'user-data');
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
  ];

  return new Promise<number>((resolve, reject) => {
    const child = spawn(browserPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    child.unref();

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Chromium launch timeout (15s)'));
    }, 15000);

    let stderrData = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
      // "DevTools listening on ws://127.0.0.1:PORT/..."
      const match = stderrData.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1]));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!stderrData.includes('DevTools listening')) {
        reject(new Error(`Chromium exited with code ${code}. stderr: ${stderrData}`));
      }
    });
  });
}

// --- Browser connection ---

interface LaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  video?: boolean;
}

const VIDEO_DIR = join(STATE_DIR, 'videos');

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

export async function connectBrowser(options: LaunchOptions = {}): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const headless = options.headless ?? true;
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const video = options.video ?? false;

  // 1. Try connecting to existing CDP port
  let port = loadCdpPort();
  if (port && await isPortAlive(port)) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      const ctx = contexts[0];
      const pages = ctx.pages();
      const page = pages.length > 0 ? pages[0] : await ctx.newPage();
      return { browser, context: ctx, page };
    }
    // No context found, create a new one
    const ctx = await browser.newContext({
      viewport,
      ...(video ? { recordVideo: { dir: VIDEO_DIR, size: viewport } } : {}),
    });
    const page = await ctx.newPage();
    return { browser, context: ctx, page };
  }

  // 2. Existing port invalid, start new Chromium
  clearCdpPort();
  port = await spawnChromium(headless);
  saveCdpPort(port);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    const ctx = contexts[0];
    const pages = ctx.pages();
    const page = pages.length > 0 ? pages[0] : await ctx.newPage();
    // Set viewport
    await page.setViewportSize(viewport);
    return { browser, context: ctx, page };
  }
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  return { browser, context: ctx, page };
}

// --- Result output ---

interface ErrorContext {
  url?: string;
  title?: string;
  tab?: number;
}

interface Result {
  success: boolean;
  screenshot?: string;
  data?: unknown;
  error?: string;
  context?: ErrorContext;
}

export function output(result: Result): void {
  console.log(JSON.stringify(result));
}

// --- Screenshot save ---

export function screenshotPath(name?: string): string {
  ensureStateDir();
  const filename = name ?? `${Date.now()}`;
  return join(SCREENSHOTS_DIR, `${filename}.png`);
}

// --- Parameter parsing ---

export function parseArgs(): string[] {
  return process.argv.slice(2);
}

export function parseFlag(args: string[], flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

// --- Safe execution wrapper ---

export async function run(
  fn: (args: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    args: string[];
  }) => Promise<Result>,
): Promise<void> {
  try {
    const cliArgs = parseArgs();
    const headed = hasFlag(cliArgs, 'headed');
    const viewportStr = parseFlag(cliArgs, 'viewport');
    const viewport = viewportStr
      ? { width: parseInt(viewportStr.split('x')[0]), height: parseInt(viewportStr.split('x')[1]) }
      : DEFAULT_VIEWPORT;

    const videoName = parseFlag(cliArgs, 'video');
    const videoEnabled = videoName !== undefined || hasFlag(cliArgs, 'video');
    const { browser, context, page: defaultPage } = await connectBrowser({ headless: !headed, viewport, video: videoEnabled });

    // Save video name for later rename on close
    if (videoEnabled && videoName) {
      ensureStateDir();
      writeFileSync(join(STATE_DIR, 'video-name.txt'), videoName);
    }

    // Select specific tab with --tab=N
    const tabStr = parseFlag(cliArgs, 'tab');
    let page = defaultPage;
    if (tabStr !== undefined) {
      const tabIdx = parseInt(tabStr);
      const pages = context.pages();
      if (!isNaN(tabIdx) && tabIdx >= 0 && tabIdx < pages.length) {
        page = pages[tabIdx];
      }
    }

    const result = await fn({
      browser,
      context,
      page,
      args: cliArgs.filter(a => !a.startsWith('--')),
    });

    output(result);
    // CDP disconnect — browser process stays alive
    process.exit(0);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorResult: Result = { success: false, error: errorMessage };

    // Capture diagnostic context from the page if available
    try {
      const ctx = await connectBrowser({ headless: true });
      const cliArgs = parseArgs();
      const tabStr = parseFlag(cliArgs, 'tab');
      let diagnosticPage = ctx.page;

      const errorContext: ErrorContext = {};

      if (tabStr !== undefined) {
        const tabIdx = parseInt(tabStr);
        const pages = ctx.context.pages();
        if (!isNaN(tabIdx) && tabIdx >= 0 && tabIdx < pages.length) {
          diagnosticPage = pages[tabIdx];
        }
        errorContext.tab = parseInt(tabStr);
      }

      errorContext.url = diagnosticPage.url();
      errorContext.title = await diagnosticPage.title().catch(() => undefined);
      errorResult.context = errorContext;

      // Capture error screenshot
      const errorScreenshotPath = screenshotPath(`error-${Date.now()}`);
      await diagnosticPage.screenshot({ path: errorScreenshotPath }).catch(() => {});
      if (existsSync(errorScreenshotPath)) {
        errorResult.screenshot = errorScreenshotPath;
      }
    } catch {
      // If we can't gather diagnostics, proceed with the basic error
    }

    output(errorResult);
    process.exit(1);
  }
}
