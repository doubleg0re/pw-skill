// profiles-command.ts — `pw profiles`: list every pw dedicated profile on disk
// (active, dead, or dormant/closed), with the browser it was created with.
// Dormant profiles are the ones `pw sessions` can't show (no session.json).
import { execFileSync } from 'child_process';
import { statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  listProfileNames,
  readProfileMeta,
  getSession,
  isProcessAlive,
  getBoundSession,
  profileUserDataDir,
  type ProfileMeta,
} from './session.js';

function lastUsedOf(name: string, meta: ProfileMeta | null): string | null {
  if (meta?.lastUsedAt) return meta.lastUsedAt;
  try {
    return statSync(profileUserDataDir(name)).mtime.toISOString();
  } catch {
    return null;
  }
}

// Best-effort disk usage in one `du` call; opt-in because it walks every profile.
function computeSizesKb(names: string[]): Record<string, number> {
  const root = join(homedir(), '.playwright-state', 'sessions');
  const out: Record<string, number> = {};
  try {
    const res = execFileSync('du', ['-sk', ...names.map(n => join(root, n))], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    for (const line of res.split('\n')) {
      const m = line.match(/^(\d+)\t(.+)$/);
      if (m) out[m[2].split('/').pop() as string] = Number(m[1]);
    }
  } catch {
    /* du unavailable — sizes omitted */
  }
  return out;
}

export function listProfilesCommand(opts: { size?: boolean } = {}): { success: boolean; data: any } {
  const bound = getBoundSession();
  const names = listProfileNames();
  const sizes = opts.size ? computeSizesKb(names) : {};

  const profiles = names.map(name => {
    const meta = readProfileMeta(name);
    const session = getSession(name);
    const alive = session ? isProcessAlive(session.pid) : false;
    // active = running; dead = registered but process gone; dormant = closed (no session.json)
    const status = alive ? 'active' : session ? 'dead' : 'dormant';
    return {
      name,
      status,
      browser: meta?.browser ?? session?.browser ?? null,
      stealth: !!(meta?.stealth ?? session?.stealth),
      bound: name === bound,
      lastUsedAt: lastUsedOf(name, meta),
      createdAt: meta?.createdAt ?? null,
      ...(opts.size ? { sizeKb: sizes[name] ?? null } : {}),
    };
  }).sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));

  const counts = profiles.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  return { success: true, data: { count: profiles.length, counts, profiles } };
}
