// session-commands.ts — Implementation of pw launch/use/sessions/close
import { chromium } from 'playwright';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions,
  isProcessAlive,
  isSessionAlive,
  resolveSession,
  generateSessionId,
  bindSession,
  unbindSession,
  getBoundSession,
  cleanupDeadSessions,
  sessionUserDataDir,
  localStateDir,
} from './session.js';
import { autoRenameVideo } from './video-utils.js';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
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

async function launchBrowserServer(headless: boolean, userDataDir?: string): Promise<{ wsEndpoint: string; pid: number; port: number }> {
  const serverScript = join(resolve(import.meta.dirname || __dirname), 'browser-server.ts');

  return new Promise<{ wsEndpoint: string; pid: number; port: number }>((res, reject) => {
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
      const lines = output.split('\n');
      for (const line of lines) {
        try {
          const data = JSON.parse(line.trim());
          if (data.wsEndpoint) {
            clearTimeout(timeout);
            const portMatch = data.wsEndpoint.match(/:(\d+)\//);
            res({ wsEndpoint: data.wsEndpoint, pid: data.pid, port: portMatch ? parseInt(portMatch[1]) : 0 });
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
    const { wsEndpoint, pid, port } = await launchBrowserServer(!headed, userDataDir);
    const session = createSession(sessionName, port, pid, wsEndpoint, videoName || (videoEnabled ? sessionName : null));

    // Auto-bind to current project
    bindSession(sessionName);

    // Navigate to URL if provided
    if (url) {
      const browser = await chromium.connect(wsEndpoint);

      const videoDir = join(localStateDir(), 'videos');
      if (videoEnabled && !existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });

      const ctx = await browser.newContext({
        ...(videoEnabled ? { recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } } } : {}),
      });
      const page = await ctx.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title();

      // Save lastUrl + storageState for reconnection
      updateSession(sessionName, { lastUrl: url });
      const stateDir = localStateDir();
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      await ctx.storageState({ path: join(stateDir, 'state.json') }).catch(() => {});

      return {
        success: true,
        data: {
          session: { ...session, lastUrl: url },
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

export async function useSession(name: string | undefined, force: boolean): Promise<{ success: boolean; data?: any; error?: string }> {
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

  // Check existing binding
  const bound = getBoundSession();
  if (bound && bound !== name) {
    if (!force) {
      return {
        success: false,
        error: `Session "${bound}" is already bound. Close it first (\`pw close\`) or use \`pw use ${name} --force\` to switch.`,
      };
    }
    // --force: kill existing session, then bind new one
    await killSession(bound);
    if (getBoundSession() === bound) {
      unbindSession();
    }
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

  // Kill by PID
  if (isProcessAlive(session.pid)) {
    try {
      process.kill(session.pid);
    } catch (err) {
      throw new Error(
        `Failed to kill session "${name}" (pid ${session.pid}): ${err instanceof Error ? err.message : String(err)}. ` +
        (process.platform === 'win32'
          ? 'Try running as Administrator.'
          : 'Check process permissions.')
      );
    }

    // Verify it's actually dead (give it a moment)
    await new Promise(r => setTimeout(r, 500));
    if (isProcessAlive(session.pid)) {
      // Try SIGKILL as last resort (Unix only)
      if (process.platform !== 'win32') {
        try { process.kill(session.pid, 'SIGKILL'); } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
      if (isProcessAlive(session.pid)) {
        throw new Error(
          `Session "${name}" (pid ${session.pid}) refused to terminate. ` +
          (process.platform === 'win32'
            ? 'Try: taskkill /PID ' + session.pid + ' /F (as Administrator)'
            : 'Try: kill -9 ' + session.pid)
        );
      }
    }
  }

  // Auto-rename video
  autoRenameVideo(localStateDir());

  // Remove session metadata but keep user-data for resume
  deleteSession(name, true);
}
