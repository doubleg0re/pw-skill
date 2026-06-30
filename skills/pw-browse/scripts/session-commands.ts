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
import { launchBrowserServer, parseViewportSpec } from './common.js';
import { runHooks } from './rary.js';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { applyViewportMode } from './viewport-utils.js';
import {
  applyViewportOverride,
  getDevicePresetWarning,
  isDevicePresetDisabled,
  resolveDevicePreset,
} from './device-presets.js';

// --- Helpers ---

function parseFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

// --- Launch ---

export async function launchSession(args: string[]): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = args.filter(a => !a.startsWith('--'))[0];
  const name = parseFlag(args, 'name') || `s-${generateSessionId()}`;
  const resume = parseFlag(args, 'resume');
  const viewportFlag = parseFlag(args, 'viewport');
  const viewportRequested = viewportFlag !== undefined;
  const viewport = parseViewportSpec(viewportFlag);
  const deviceFlag = parseFlag(args, 'device');
  const deviceRequested = deviceFlag !== undefined;
  let devicePreset: ReturnType<typeof applyViewportOverride> | null = null;
  try {
    devicePreset = deviceRequested && !isDevicePresetDisabled(deviceFlag)
      ? applyViewportOverride(resolveDevicePreset(deviceFlag), viewportRequested ? viewport : undefined)
      : null;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  const screenshotPathFlag = parseFlag(args, 'screenshot-path');
  const headed = hasFlag(args, 'headed');
  const videoName = parseFlag(args, 'video');
  const videoEnabled = videoName !== undefined || hasFlag(args, 'video');
  const screenshotDir = screenshotPathFlag ? resolve(screenshotPathFlag) : join(localStateDir(), 'screenshots');

  const sessionName = resume || name;

  // Check if session already running
  if (isSessionAlive(sessionName)) {
    const existing = getSession(sessionName)!;
    const previous = getBoundSession();
    const warnings: string[] = [];
    if (screenshotPathFlag) {
      updateSession(sessionName, { screenshotDir });
      existing.screenshotDir = screenshotDir;
    }
    if (deviceRequested) {
      // Device emulation is fixed at context creation; it cannot change on a running session.
      if (devicePreset && existing.device !== devicePreset.name) {
        warnings.push(`--device applies at launch and cannot be changed mid-session (session "${sessionName}" is using ${existing.device ? `"${existing.device}"` : 'no device'}). Relaunch to change: pw close --session=${sessionName} :: launch --device="${devicePreset.name}".`);
      } else if (!devicePreset && existing.device) {
        warnings.push(`--device applies at launch; relaunch without --device to clear "${existing.device}".`);
      } else if (devicePreset) {
        const warning = getDevicePresetWarning(devicePreset);
        if (warning) warnings.push(warning);
      }
    } else if (viewportRequested) {
      const browser = existing.cdpEndpoint
        ? await chromium.connectOverCDP(existing.cdpEndpoint).catch(() => existing.wsEndpoint ? chromium.connect(existing.wsEndpoint) : Promise.reject(new Error('CDP connect failed')))
        : await chromium.connect(existing.wsEndpoint);
      const ctx = browser.contexts()[0] || await browser.newContext();
      const pages = ctx.pages();
      const page = pages.length > 0 ? pages[0] : await ctx.newPage();
      await applyViewportMode(page, viewport);
    }
    bindSession(sessionName);
    return {
      success: true,
      data: {
        session: existing,
        message: `Session "${sessionName}" already running, reconnected`,
        bound: true,
        ...(previous && previous !== sessionName ? { previous } : {}),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  try {
    const userDataDir = sessionUserDataDir(sessionName);
    const { wsEndpoint, cdpEndpoint, pid, port } = await launchBrowserServer(
      !headed,
      userDataDir,
      devicePreset ? { name: devicePreset.name, viewport: viewportRequested ? viewport : undefined } : undefined,
    );
    const session = createSession(sessionName, port, pid, wsEndpoint, videoName || (videoEnabled ? sessionName : null), screenshotDir);
    const warnings: string[] = [];
    if (cdpEndpoint) {
      updateSession(sessionName, { cdpEndpoint });
      (session as any).cdpEndpoint = cdpEndpoint;
    }
    if (devicePreset) {
      updateSession(sessionName, { device: devicePreset.name });
      session.device = devicePreset.name;
      const warning = getDevicePresetWarning(devicePreset);
      if (warning) warnings.push(warning);
    } else if (viewportRequested) {
      updateSession(sessionName, { device: undefined });
    }

    // Auto-bind to current project
    bindSession(sessionName);

    // Run extension launch hooks
    const { buildRuntime } = await import('./runtime.js');
    const launchRuntime = buildRuntime({ session });
    const hookResult = await runHooks('launch', launchRuntime);

    // Navigate to URL if provided, or apply explicit viewport to the initial page
    if (url || viewportRequested || deviceRequested) {
      const browser = cdpEndpoint
        ? await chromium.connectOverCDP(cdpEndpoint).catch(() => chromium.connect(wsEndpoint))
        : await chromium.connect(wsEndpoint);

      // Reuse default context for DOM persistence
      let ctx, page;
      if (videoEnabled) {
        const videoDir = join(localStateDir(), 'videos');
        if (!existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });
        ctx = await browser.newContext({ recordVideo: { dir: videoDir } });
        page = await ctx.newPage();
      } else {
        ctx = browser.contexts()[0] || await browser.newContext();
        const pages = ctx.pages();
        page = pages.length > 0 ? pages[0] : await ctx.newPage();
      }

      // devicePreset is applied natively by browser-server at context creation;
      // only a plain --viewport (no device) needs a runtime resize here.
      if (viewportRequested && !devicePreset) {
        await applyViewportMode(page, viewport);
      }

      let title: string | undefined;
      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        title = await page.title();
      }

      // Save lastUrl + storageState for reconnection
      if (url) updateSession(sessionName, { lastUrl: url });
      const stateDir = localStateDir();
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      await ctx.storageState({ path: join(stateDir, 'state.json') }).catch(() => {});

      return {
        success: true,
        data: {
          session: url ? { ...session, lastUrl: url } : session,
          ...(url ? { url, title } : {}),
          resumed: !!resume,
          hooks: hookResult.ran.length > 0 ? hookResult : undefined,
        },
        ...((warnings.length > 0 || hookResult.errors.length > 0)
          ? { warnings: [...warnings, ...hookResult.errors] }
          : {}),
      };
    }

    return {
      success: true,
      data: {
        session,
        resumed: !!resume,
        hooks: hookResult.ran.length > 0 ? hookResult : undefined,
      },
      ...((warnings.length > 0 || hookResult.errors.length > 0)
        ? { warnings: [...warnings, ...hookResult.errors] }
        : {}),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Use ---

export async function useSession(name?: string): Promise<{ success: boolean; data?: any; error?: string }> {
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

  const previous = getBoundSession();
  bindSession(name);
  return {
    success: true,
    data: {
      session: name,
      bound: true,
      ...(previous && previous !== name ? { previous } : {}),
    },
  };
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
    const allHookErrors: string[] = [];
    for (const s of sessions) {
      const { hookErrors } = await killSession(s.name);
      closed.push(s.name);
      if (hookErrors) allHookErrors.push(...hookErrors);
    }
    unbindSession();
    return {
      success: true,
      data: { closed },
      ...(allHookErrors.length > 0 ? { warnings: allHookErrors } : {}),
    };
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
    const { hookErrors } = await killSession(name);
    // Unbind if this was the bound session
    if (getBoundSession() === name) {
      unbindSession();
    }
    return {
      success: true,
      data: { closed: name },
      ...(hookErrors ? { warnings: hookErrors } : {}),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function killSession(name: string): Promise<{ hookErrors?: string[] }> {
  const session = getSession(name);
  if (!session) return {};

  // Run extension close hooks + cleanups before killing
  const { buildRuntime, runCleanups } = await import('./runtime.js');
  const closeRuntime = buildRuntime({ session });
  const hookResult = await runHooks('close', closeRuntime).catch((err) => ({
    ran: [] as string[],
    errors: [`Close hooks failed: ${err instanceof Error ? err.message : String(err)}`],
  }));
  // Run registered cleanups
  const cleanupResult = await runCleanups(closeRuntime).catch(() => ({ ran: 0, errors: [] as string[] }));
  if (cleanupResult.errors.length > 0) {
    hookResult.errors.push(...cleanupResult.errors.map(e => `Cleanup error: ${e}`));
  }

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

  return { hookErrors: hookResult.errors.length > 0 ? hookResult.errors : undefined };
}
