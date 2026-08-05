// browser-catalog.ts — where each Chromium-family browser keeps its profiles,
// plus a pure parser for the profile list. Used by `pw browsers` discovery.
// The app binaries themselves live in browser-resolve.ts (MAC_BROWSER_PATHS).
import { homedir } from 'os';
import { join } from 'path';

/** macOS user-data roots (the dir holding "Local State" and the profile dirs). */
export const MAC_USER_DATA_ROOTS: Record<string, string> = {
  brave: join(homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
  chrome: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  edge: join(homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
};

export interface ProfileInfo {
  /** On-disk profile directory, e.g. "Default" or "Profile 2". */
  dir: string;
  /** Display name the user set, e.g. "Mo". */
  name: string;
  /** Whether this was the browser's most recently used profile. */
  lastUsed: boolean;
}

/**
 * Parse a browser's "Local State" JSON into its profile list. Pure — the caller
 * reads the file. Returns [] for missing/garbage input rather than throwing.
 */
export function parseProfiles(localState: unknown): ProfileInfo[] {
  const profile = (localState as any)?.profile;
  const infoCache = profile?.info_cache;
  if (!infoCache || typeof infoCache !== 'object') return [];
  const lastUsed = typeof profile?.last_used === 'string' ? profile.last_used : '';
  return Object.entries(infoCache).map(([dir, meta]) => ({
    dir,
    name: (meta as any)?.name || dir,
    lastUsed: dir === lastUsed,
  }));
}

/** Parse the pid out of a Chromium SingletonLock symlink target ("host-1234"). */
export function pidFromSingletonLock(linkTarget: string | null | undefined): number | null {
  if (!linkTarget) return null;
  const match = linkTarget.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}
