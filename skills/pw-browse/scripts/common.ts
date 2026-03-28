// ~/.claude/skills/pw-browse/scripts/common.ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import {
  resolveSession,
  createSession,
  getSession,
  updateSession,
  isSessionAlive,
  sessionUserDataDir,
  localStateDir,
  globalSessionDir,
  generateSessionId,
  type SessionInfo,
} from './session.js';

// --- Local state directory (per project) ---

const LOCAL_STATE_DIR = localStateDir();
const SCREENSHOTS_DIR = join(LOCAL_STATE_DIR, 'screenshots');

export function ensureStateDir(): void {
  if (!existsSync(LOCAL_STATE_DIR)) mkdirSync(LOCAL_STATE_DIR, { recursive: true });
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// --- storageState load/save ---

export function loadState(): string | undefined {
  const stateFile = join(LOCAL_STATE_DIR, 'state.json');
  if (existsSync(stateFile)) return stateFile;
  return undefined;
}

export function saveState(context: BrowserContext): Promise<void> {
  ensureStateDir();
  return context.storageState({ path: join(LOCAL_STATE_DIR, 'state.json') });
}

// --- WebSocket liveness check ---

async function isWsAlive(wsEndpoint: string): Promise<boolean> {
  try {
    // Extract port from ws://localhost:PORT/... and check HTTP endpoint
    const match = wsEndpoint.match(/:(\d+)\//);
    if (!match) return false;
    const res = await fetch(`http://localhost:${match[1]}/json`);
    return res.ok;
  } catch {
    return false;
  }
}

// --- Chromium CDP process management ---

async function launchBrowserServer(headless: boolean, userDataDir?: string): Promise<{ wsEndpoint: string; pid: number }> {
  const serverScript = join(resolve(import.meta.dirname || __dirname), 'browser-server.ts');

  return new Promise<{ wsEndpoint: string; pid: number }>((res, reject) => {
    const child = spawn(process.execPath, [
      ...process.execArgv,
      serverScript,
      ...(headless ? ['--headless'] : []),
      ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
    ], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });
    child.unref();

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Browser server launch timeout (15s)'));
    }, 15000);

    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      // Look for JSON line with wsEndpoint
      const lines = output.split('\n');
      for (const line of lines) {
        try {
          const data = JSON.parse(line.trim());
          if (data.wsEndpoint) {
            clearTimeout(timeout);
            res({ wsEndpoint: data.wsEndpoint, pid: data.pid });
            return;
          }
        } catch {}
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!output.includes('wsEndpoint')) {
        reject(new Error(`Browser server exited with code ${code}`));
      }
    });
  });
}

// --- Browser connection ---

interface ConnectOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  video?: boolean;
  sessionName?: string;
  restoreUrl?: boolean; // restore lastUrl on reconnect (default: true)
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

/**
 * Connect to an existing session's browser, or launch a new one.
 * Uses the global session manager for process tracking.
 */
export async function connectBrowser(options: ConnectOptions = {}): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  session: SessionInfo;
}> {
  const headless = options.headless ?? true;
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const video = options.video ?? false;
  const videoDir = join(LOCAL_STATE_DIR, 'videos');

  // Resolve which session to use
  let session: SessionInfo;
  try {
    session = resolveSession(options.sessionName);
  } catch {
    // No active session — will launch below
    return launchNewSession({ headless, viewport, video, videoDir });
  }

  // Try connecting to resolved session via WebSocket
  if (session.wsEndpoint && await isWsAlive(session.wsEndpoint)) {
    const browser = await chromium.connect(session.wsEndpoint);

    // Load storageState from local state if available
    const stateFile = join(LOCAL_STATE_DIR, 'state.json');
    const storageState = existsSync(stateFile) ? stateFile : undefined;

    const ctx = await browser.newContext({
      viewport,
      acceptDownloads: true,
      ...(storageState ? { storageState } : {}),
      ...(video ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
    });
    const page = await ctx.newPage();

    // Restore last URL if available and not disabled
    const shouldRestore = options.restoreUrl !== false;
    if (shouldRestore && session.lastUrl && session.lastUrl !== 'about:blank') {
      await page.goto(session.lastUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    return { browser, context: ctx, page, session };
  }

  // Session exists but port is dead — clean up and relaunch with same profile
  return launchNewSession({ headless, viewport, video, videoDir, resumeName: session.name });
}

async function launchNewSession(opts: {
  headless: boolean;
  viewport: { width: number; height: number };
  video: boolean;
  videoDir: string;
  resumeName?: string;
  name?: string;
}): Promise<{ browser: Browser; context: BrowserContext; page: Page; session: SessionInfo }> {
  const sessionName = opts.resumeName || opts.name || `s-${generateSessionId()}`;
  const userDataDir = sessionUserDataDir(sessionName);

  const { wsEndpoint, pid } = await launchBrowserServer(opts.headless, userDataDir);

  // Extract port from ws://localhost:PORT/...
  const portMatch = wsEndpoint.match(/:(\d+)\//);
  const port = portMatch ? parseInt(portMatch[1]) : 0;

  const session = createSession(sessionName, port, pid, wsEndpoint, opts.video ? sessionName : null);

  const browser = await chromium.connect(wsEndpoint);

  const ctx = await browser.newContext({
    viewport: opts.viewport,
    acceptDownloads: true,
    ...(opts.video ? { recordVideo: { dir: opts.videoDir, size: opts.viewport } } : {}),
  });
  const page = await ctx.newPage();
  return { browser, context: ctx, page, session };
}

/**
 * Launch a new named session explicitly.
 * Used by `pw launch` command.
 */
export async function launchSession(opts: {
  name?: string;
  resume?: string;
  headless: boolean;
  viewport: { width: number; height: number };
  video: boolean;
}): Promise<{ browser: Browser; context: BrowserContext; page: Page; session: SessionInfo }> {
  const videoDir = join(LOCAL_STATE_DIR, 'videos');

  if (opts.resume) {
    // Resume: reuse profile
    return launchNewSession({
      headless: opts.headless,
      viewport: opts.viewport,
      video: opts.video,
      videoDir,
      resumeName: opts.resume,
    });
  }

  return launchNewSession({
    headless: opts.headless,
    viewport: opts.viewport,
    video: opts.video,
    videoDir,
    name: opts.name,
  });
}

// --- Result output ---

interface ErrorContext {
  url?: string;
  title?: string;
  tab?: number;
  session?: string;
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
    session: SessionInfo;
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
    const sessionName = parseFlag(cliArgs, 'session');
    const noRestore = hasFlag(cliArgs, 'no-restore');

    const { browser, context, page: defaultPage, session } = await connectBrowser({
      headless: !headed,
      viewport,
      video: videoEnabled,
      sessionName,
      restoreUrl: !noRestore,
    });

    // Save video metadata for rename on close
    if (videoEnabled && videoName) {
      ensureStateDir();
      const videoPath = await defaultPage.video()?.path()?.catch(() => null) ?? null;
      writeFileSync(join(LOCAL_STATE_DIR, 'video-meta.json'), JSON.stringify({ name: videoName, file: videoPath }));
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
      session,
    });

    // Save current URL + storageState for next connection
    try {
      const currentUrl = page.url();
      if (currentUrl && currentUrl !== 'about:blank') {
        updateSession(session.name, { lastUrl: currentUrl });
      }
      await context.storageState({ path: join(LOCAL_STATE_DIR, 'state.json') }).catch(() => {});
    } catch {}

    output(result);
    process.exit(0);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorResult: Result = { success: false, error: errorMessage };

    // Capture diagnostic context
    try {
      const conn = await connectBrowser({ headless: true });
      const cliArgs = parseArgs();
      const tabStr = parseFlag(cliArgs, 'tab');

      const errorContext: ErrorContext = { session: conn.session.name };
      let diagnosticPage = conn.page;

      if (tabStr !== undefined) {
        const tabIdx = parseInt(tabStr);
        const pages = conn.context.pages();
        if (!isNaN(tabIdx) && tabIdx >= 0 && tabIdx < pages.length) {
          diagnosticPage = pages[tabIdx];
        }
        errorContext.tab = tabIdx;
      }

      errorContext.url = diagnosticPage.url();
      errorContext.title = await diagnosticPage.title().catch(() => undefined);
      errorResult.context = errorContext;

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
