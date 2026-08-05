// browsers-command.ts — `pw browsers`: discover installed Chromium-family
// browsers, their real profiles, and whether each is currently running.
// Read-only; never touches a running browser.
import { existsSync, readFileSync, readlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { MAC_BROWSER_PATHS } from './browser-resolve.js';
import { MAC_USER_DATA_ROOTS, parseProfiles, pidFromSingletonLock, type ProfileInfo } from './browser-catalog.js';
import { isProcessAlive } from './session.js';

function readVersion(binPath: string): string | null {
  try {
    return execFileSync(binPath, ['--version'], { encoding: 'utf-8', timeout: 4000 }).trim();
  } catch {
    return null;
  }
}

function readProfiles(userDataRoot: string): ProfileInfo[] {
  const localStatePath = join(userDataRoot, 'Local State');
  if (!existsSync(localStatePath)) return [];
  try {
    return parseProfiles(JSON.parse(readFileSync(localStatePath, 'utf-8')));
  } catch {
    return [];
  }
}

// A Chromium user-data-dir is "running" when its SingletonLock symlink points at
// a live pid. The lock is per user-data-dir (all profiles share one), so this is
// really "is this browser instance up".
function readRunning(userDataRoot: string): { running: boolean; pid: number | null } {
  try {
    const pid = pidFromSingletonLock(readlinkSync(join(userDataRoot, 'SingletonLock')));
    return { running: pid != null && isProcessAlive(pid), pid };
  } catch {
    return { running: false, pid: null };
  }
}

export function listBrowsersCommand(): { success: boolean; data: any } {
  const browsers = Object.entries(MAC_BROWSER_PATHS).map(([key, { path, label }]) => {
    const installed = existsSync(path);
    const userDataRoot = MAC_USER_DATA_ROOTS[key];
    const { running, pid } = installed ? readRunning(userDataRoot) : { running: false, pid: null };
    return {
      name: key,
      label,
      installed,
      version: installed ? readVersion(path) : null,
      executablePath: path,
      userDataRoot,
      running,
      runningPid: pid,
      profiles: installed ? readProfiles(userDataRoot) : [],
    };
  });

  return {
    success: true,
    data: {
      browsers,
      note:
        'A browser\'s real profiles cannot be driven directly (Chromium 136+ blocks remote debugging on the default profile). ' +
        'pw drives the real browser binary with its own dedicated profile: `pw launch --browser=<name> --name=<x>` (log in once, it persists).',
    },
  };
}
