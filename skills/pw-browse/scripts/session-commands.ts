// session-commands.ts — Implementation of pw launch/use/sessions/close
import { chromium } from 'playwright';
import {
  createSession,
  getSession,
  deleteSession,
  listSessions,
  isProcessAlive,
  isSessionAlive,
  resolveSession,
  sessionUserDataDir,
  globalSessionDir,
  generateSessionId,
  bindSession,
  unbindSession,
  getBoundSession,
  cleanupDeadSessions,
  localStateDir,
} from './session.js';
import { autoRenameVideo } from './video-utils.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

// --- Helpers ---

function parseFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

async function isPortAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function spawnChromium(headless: boolean, userDataDir: string): Promise<{ port: number; pid: number }> {
  const browserPath = chromium.executablePath();
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
  ];

  return new Promise<{ port: number; pid: number }>((res, reject) => {
    const child = spawn(browserPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    child.unref();

    const pid = child.pid!;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Chromium launch timeout (15s)'));
    }, 15000);

    let stderrData = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
      const match = stderrData.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        res({ port: parseInt(match[1]), pid });
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

// --- Launch ---

export async function launchSession(args: string[]): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = args.filter(a => !a.startsWith('--'))[0];
  const name = parseFlag(args, 'name') || `s-${generateSessionId()}`;
  const resume = parseFlag(args, 'resume');
  const headed = hasFlag(args, 'headed');
  const videoName = parseFlag(args, 'video');
  const videoEnabled = videoName !== undefined || hasFlag(args, 'video');

  const sessionName = resume || name;

  // Check if session already running
  if (isSessionAlive(sessionName)) {
    const existing = getSession(sessionName)!;
    return {
      success: true,
      data: { session: existing, message: `Session "${sessionName}" already running, reconnected` },
    };
  }

  try {
    const userDataDir = sessionUserDataDir(sessionName);
    const { port, pid } = await spawnChromium(!headed, userDataDir);
    const session = createSession(sessionName, port, pid, videoName || (videoEnabled ? sessionName : null));

    // Auto-bind to current project
    bindSession(sessionName);

    // Navigate to URL if provided
    if (url) {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const contexts = browser.contexts();
      let page;

      if (videoEnabled) {
        const videoDir = join(localStateDir(), 'videos');
        if (!existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });
        const state = contexts.length > 0 ? await contexts[0].storageState().catch(() => undefined) : undefined;
        const ctx = await browser.newContext({
          recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
          ...(state ? { storageState: state } : {}),
        });
        page = await ctx.newPage();
      } else if (contexts.length > 0) {
        const pages = contexts[0].pages();
        page = pages.length > 0 ? pages[0] : await contexts[0].newPage();
      } else {
        const ctx = await browser.newContext();
        page = await ctx.newPage();
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title();

      return {
        success: true,
        data: {
          session,
          url,
          title,
          resumed: !!resume,
        },
      };
    }

    return {
      success: true,
      data: {
        session,
        resumed: !!resume,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Use ---

export function useSession(name?: string): { success: boolean; data?: any; error?: string } {
  if (!name) {
    // Show current binding
    const bound = getBoundSession();
    if (bound) {
      const alive = isSessionAlive(bound);
      return { success: true, data: { session: bound, alive } };
    }
    return { success: true, data: { session: null, message: 'No session bound. Run `pw use <name>`' } };
  }

  const session = getSession(name);
  if (!session) {
    return { success: false, error: `Session "${name}" not found` };
  }
  if (!isProcessAlive(session.pid)) {
    return { success: false, error: `Session "${name}" is not running (pid ${session.pid} dead). Use \`pw launch --resume=${name}\` to restart.` };
  }

  bindSession(name);
  return { success: true, data: { session: name, bound: true } };
}

// --- Sessions list ---

export function listSessionsCommand(): { success: boolean; data: any } {
  // Clean up dead sessions first
  const cleaned = cleanupDeadSessions();
  const sessions = listSessions();
  const bound = getBoundSession();

  const list = sessions.map(s => ({
    ...s,
    alive: isProcessAlive(s.pid),
    bound: s.name === bound,
  }));

  return {
    success: true,
    data: {
      sessions: list,
      bound,
      cleaned: cleaned.length > 0 ? cleaned : undefined,
    },
  };
}

// --- Close ---

export async function closeSession(args: string[]): Promise<{ success: boolean; data?: any; error?: string }> {
  const sessionName = parseFlag(args, 'session');
  const closeAll = hasFlag(args, 'all');

  if (closeAll) {
    const sessions = listSessions();
    const closed: string[] = [];
    for (const s of sessions) {
      await killSession(s.name);
      closed.push(s.name);
    }
    unbindSession();
    return { success: true, data: { closed } };
  }

  // Resolve which session to close
  let name: string;
  if (sessionName) {
    name = sessionName;
  } else {
    const bound = getBoundSession();
    if (bound) {
      name = bound;
    } else {
      const alive = listSessions().filter(s => isProcessAlive(s.pid));
      if (alive.length === 1) {
        name = alive[0].name;
      } else if (alive.length === 0) {
        return { success: true, data: 'No active sessions' };
      } else {
        return {
          success: false,
          error: `Multiple sessions active. Specify --session=<name> or --all.\nActive: ${alive.map(s => s.name).join(', ')}`,
        };
      }
    }
  }

  try {
    await killSession(name);
    // Unbind if this was the bound session
    if (getBoundSession() === name) {
      unbindSession();
    }
    return { success: true, data: { closed: name } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function killSession(name: string): Promise<void> {
  const session = getSession(name);
  if (!session) return;

  // Kill by PID (reliable, cross-platform)
  if (isProcessAlive(session.pid)) {
    try {
      process.kill(session.pid);
    } catch {}
  }

  // Auto-rename video
  autoRenameVideo(localStateDir());

  // Remove session metadata but keep user-data for resume
  deleteSession(name, true);
}
