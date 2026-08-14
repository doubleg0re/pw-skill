// session.ts — Global session manager with dependency injection
// Sessions live in {globalDir}/sessions/{name}/
// Local project state lives in {localDir}/.playwright-state/
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { atomicWriteJSON } from './file-utils.js';
import { acquireLockOrThrow, releaseLock } from './lock.js';
import { ensureStateDirGitExcluded } from './git-exclude.js';

// --- Session Types ---

export interface SessionInfo {
  id: string;
  name: string;
  port: number;
  pid: number;
  wsEndpoint: string;
  cdpEndpoint?: string;
  startedAt: string;
  video: string | null;
  lastUrl?: string;
  /** Opt-in origin guard set by `pw launch/use --pin`; see pin-utils.ts. */
  pinnedOrigin?: string;
  /** Real browser this session drives (Brave/Chrome/Edge/…), if not bundled Chromium. */
  browser?: string;
  /** Opt-in: launched with --stealth (automation fingerprint navigator.webdriver hidden). */
  stealth?: boolean;
  screenshotDir?: string;
  device?: string;
  documentEpoch?: number;
  /**
   * The `.playwright-state` dir the session was launched from. Sessions live in
   * the shared global dir, so this is the only record of which cwd owns one — a
   * bare command auto-selects only sessions launched from its own cwd, so it can
   * never reach across workspaces and drive a session under test elsewhere.
   */
  originDir?: string;
}

export interface SessionStoreOptions {
  globalDir: string;
  localDir: string;
}

export interface ResolvedSessionResult {
  session: SessionInfo;
  warnings: string[];
}

// --- ID Generation ---

export function generateSessionId(): string {
  return randomBytes(4).toString('hex');
}

// --- Process check (standalone, no DI needed) ---

import { execSync } from 'child_process';

/**
 * Get process start time as ISO string. Used to detect PID recycling.
 * Returns null if unavailable.
 */
export function getProcessStartTime(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`wmic process where ProcessId=${pid} get CreationDate /format:list`, {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = output.match(/CreationDate=(\d{14})/);
      if (match) {
        const s = match[1];
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
      }
      return null;
    } else {
      const output = execSync(`ps -o lstart= -p ${pid}`, {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const trimmed = output.trim();
      if (!trimmed) return null;
      return new Date(trimmed).toISOString();
    }
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    // Basic signal check (works on Unix, limited on Windows)
    process.kill(pid, 0);
    
    // Additional check for Windows to avoid zombie/incorrect matches
    if (process.platform === 'win32') {
      try {
        const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        return output.includes(pid.toString());
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// --- Session Store Factory ---

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function createSessionStore(opts: SessionStoreOptions) {
  const sessionsDir = join(opts.globalDir, 'sessions');

  function sessionDir(name: string): string {
    return join(sessionsDir, name);
  }

  return {
    // --- CRUD ---

    createSession(name: string, port: number, pid: number, wsEndpoint: string = '', video: string | null = null, screenshotDir?: string): SessionInfo {
      const dir = sessionDir(name);
      ensureDir(dir);
      ensureDir(join(dir, 'user-data'));

      const session: SessionInfo = {
        id: generateSessionId(),
        name,
        port,
        pid,
        wsEndpoint,
        startedAt: new Date().toISOString(),
        video,
        originDir: opts.localDir,
        ...(screenshotDir ? { screenshotDir } : {}),
      };

      const lockPath = join(dir, '.lock');
      acquireLockOrThrow(lockPath, 'createSession');
      try {
        atomicWriteJSON(join(dir, 'session.json'), session);
      } finally {
        releaseLock(lockPath);
      }
      return session;
    },

    getSession(name: string): SessionInfo | null {
      const metaFile = join(sessionDir(name), 'session.json');
      if (!existsSync(metaFile)) return null;
      try {
        return JSON.parse(readFileSync(metaFile, 'utf-8'));
      } catch {
        return null;
      }
    },

    updateSession(name: string, updates: Partial<SessionInfo>): void {
      const session = this.getSession(name);
      if (!session) return;
      const updated = { ...session, ...updates };
      const lockPath = join(sessionDir(name), '.lock');
      acquireLockOrThrow(lockPath, 'updateSession');
      try {
        atomicWriteJSON(join(sessionDir(name), 'session.json'), updated);
      } finally {
        releaseLock(lockPath);
      }
    },

    deleteSession(name: string, keepProfile: boolean = true): void {
      const dir = sessionDir(name);
      if (!existsSync(dir)) return;
      if (keepProfile) {
        const metaFile = join(dir, 'session.json');
        if (existsSync(metaFile)) unlinkSync(metaFile);
      } else {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    listSessions(): SessionInfo[] {
      ensureDir(sessionsDir);
      const dirs = readdirSync(sessionsDir);
      const sessions: SessionInfo[] = [];
      for (const dir of dirs) {
        const session = this.getSession(dir);
        if (session) sessions.push(session);
      }
      return sessions;
    },

    // --- Liveness ---

    isSessionAlive(name: string): boolean {
      const session = this.getSession(name);
      if (!session) return false;
      return isProcessAlive(session.pid);
    },

    cleanupDeadSessions(): string[] {
      const cleaned: string[] = [];
      for (const session of this.listSessions()) {
        if (!isProcessAlive(session.pid)) {
          this.deleteSession(session.name, true);
          cleaned.push(session.name);
        }
      }
      return cleaned;
    },

    // --- Binding ---

    getBoundSession(): string | null {
      const bindFile = join(opts.localDir, 'current-session.txt');
      if (!existsSync(bindFile)) return null;
      return readFileSync(bindFile, 'utf-8').trim() || null;
    },

    bindSession(name: string): void {
      ensureDir(opts.localDir);
      writeFileSync(join(opts.localDir, 'current-session.txt'), name);
      ensureStateDirGitExcluded(dirname(opts.localDir));
    },

    unbindSession(): void {
      const bindFile = join(opts.localDir, 'current-session.txt');
      if (existsSync(bindFile)) unlinkSync(bindFile);
    },

    // --- Resolution ---

    resolveSessionWithContext(sessionFlag?: string): ResolvedSessionResult {
      // 1. Explicit --session
      if (sessionFlag) {
        const session = this.getSession(sessionFlag);
        if (!session) throw new Error(`Session "${sessionFlag}" not found`);
        if (!isProcessAlive(session.pid)) throw new Error(`Session "${sessionFlag}" is not running (pid ${session.pid} dead)`);
        return { session, warnings: [] };
      }

      // 2. Bound session (pw use)
      const bound = this.getBoundSession();
      if (bound) {
        const session = this.getSession(bound);
        if (session && isProcessAlive(session.pid)) {
          return { session, warnings: [] };
        }
      }

      // 3. Only one alive session launched from THIS cwd → auto-select.
      //    Foreign-cwd sessions are never picked implicitly: a bare command
      //    must not reach across workspaces and drive a session under test
      //    elsewhere (gitea #7).
      const alive = this.listSessions().filter(s => isProcessAlive(s.pid));
      const local = alive.filter(s => s.originDir === opts.localDir);
      if (local.length === 1) {
        const session = local[0];
        const warnings: string[] = [];

        if (!bound) {
          this.bindSession(session.name);
          warnings.push(`No session was bound for this cwd. Auto-bound "${session.name}".`);
        } else if (bound !== session.name) {
          this.bindSession(session.name);
          warnings.push(`Bound session "${bound}" was unavailable. Auto-bound "${session.name}".`);
        }

        return { session, warnings };
      }
      throw this.noAutoSelectError(alive, local);
    },

    /**
     * The failure when no single local session can be auto-selected. Kept in one
     * place so both resolvers name the same distinctions: nothing running, an
     * ambiguous set of local sessions, or live sessions that only exist in other
     * cwds (which must be addressed with --session, never grabbed implicitly).
     */
    noAutoSelectError(alive: SessionInfo[], local: SessionInfo[]): Error {
      if (local.length > 1) {
        return new Error(
          `Multiple active sessions. Specify --session=<name> or run \`pw use <name>\`.\n` +
          `Active: ${local.map(s => s.name).join(', ')}`
        );
      }
      if (alive.length === 0) return new Error('No active sessions. Run `pw launch` first.');
      return new Error(
        `No session was launched from this directory. ` +
        `Live sessions exist elsewhere (${alive.map(s => s.name).join(', ')}); ` +
        `pass --session=<name> to target one, or run \`pw launch\` here.`
      );
    },

    resolveSession(sessionFlag?: string): SessionInfo {
      // Pure read-only lookup — no side effects (no auto-binding).
      // 1. Explicit --session
      if (sessionFlag) {
        const session = this.getSession(sessionFlag);
        if (!session) throw new Error(`Session "${sessionFlag}" not found`);
        if (!isProcessAlive(session.pid)) throw new Error(`Session "${sessionFlag}" is not running (pid ${session.pid} dead)`);
        return session;
      }

      // 2. Bound session
      const bound = this.getBoundSession();
      if (bound) {
        const session = this.getSession(bound);
        if (session && isProcessAlive(session.pid)) return session;
      }

      // 3. Only one alive session from THIS cwd → return it (but don't bind).
      //    Foreign-cwd sessions are never picked implicitly (gitea #7).
      const alive = this.listSessions().filter(s => isProcessAlive(s.pid));
      const local = alive.filter(s => s.originDir === opts.localDir);
      if (local.length === 1) return local[0];
      throw this.noAutoSelectError(alive, local);
    },

    // --- Profile ---

    sessionUserDataDir(name: string): string {
      const dir = join(sessionDir(name), 'user-data');
      ensureDir(dir);
      return dir;
    },

    hasProfile(name: string): boolean {
      return existsSync(join(sessionDir(name), 'user-data'));
    },

    // --- Paths (for external use) ---

    get globalDir() { return opts.globalDir; },
    get localDir() { return opts.localDir; },
    globalSessionDir: sessionDir,
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

// --- Default instance (production) ---

const defaultStore = createSessionStore({
  globalDir: join(homedir(), '.playwright-state'),
  localDir: join(process.cwd(), '.playwright-state'),
});

// Re-export all methods from default store for backward compatibility
export const createSession = defaultStore.createSession.bind(defaultStore);
export const getSession = defaultStore.getSession.bind(defaultStore);
export const updateSession = defaultStore.updateSession.bind(defaultStore);
export const deleteSession = defaultStore.deleteSession.bind(defaultStore);
export const listSessions = defaultStore.listSessions.bind(defaultStore);
export const isSessionAlive = defaultStore.isSessionAlive.bind(defaultStore);
export const cleanupDeadSessions = defaultStore.cleanupDeadSessions.bind(defaultStore);
export const getBoundSession = defaultStore.getBoundSession.bind(defaultStore);
export const bindSession = defaultStore.bindSession.bind(defaultStore);
export const unbindSession = defaultStore.unbindSession.bind(defaultStore);
export const resolveSessionWithContext = defaultStore.resolveSessionWithContext.bind(defaultStore);
export const resolveSession = defaultStore.resolveSession.bind(defaultStore);
export const sessionUserDataDir = defaultStore.sessionUserDataDir.bind(defaultStore);
export const hasProfile = defaultStore.hasProfile.bind(defaultStore);
export const globalSessionDir = defaultStore.globalSessionDir.bind(defaultStore);
export function localStateDir(cwd?: string): string {
  return cwd ? join(cwd, '.playwright-state') : defaultStore.localDir;
}

export function advanceDocumentEpoch(sessionName: string): number {
  const session = defaultStore.getSession(sessionName);
  const next = (session?.documentEpoch ?? 0) + 1;
  defaultStore.updateSession(sessionName, { documentEpoch: next });
  return next;
}

export function getDocumentEpoch(sessionName: string): number {
  const session = defaultStore.getSession(sessionName);
  return session?.documentEpoch ?? 0;
}

// --- Durable per-profile metadata ---
// profile.json is separate from the ephemeral session.json: it survives `pw close`
// (which deletes session.json but keeps the profile dir), so a dormant profile
// remembers its browser + stealth choice. Lets `pw launch --name=X` restore them
// and `pw profiles` list closed profiles.

export interface ProfileMeta {
  browser?: string;
  stealth?: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

function profileMetaPath(name: string): string {
  return join(defaultStore.globalSessionDir(name), 'profile.json');
}

export function readProfileMeta(name: string): ProfileMeta | null {
  const p = profileMetaPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ProfileMeta;
  } catch {
    return null;
  }
}

export function writeProfileMeta(name: string, patch: Partial<ProfileMeta>): void {
  const dir = defaultStore.globalSessionDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next: ProfileMeta = { ...(readProfileMeta(name) || {}), ...patch };
  if (!next.createdAt) next.createdAt = new Date().toISOString();
  atomicWriteJSON(profileMetaPath(name), next);
}

/** All on-disk profile directory names under the global sessions dir. */
export function listProfileNames(): string[] {
  const dir = join(defaultStore.globalDir, 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}

/** Absolute path to a profile's persistent browser user-data dir, if present. */
export function profileUserDataDir(name: string): string {
  return join(defaultStore.globalSessionDir(name), 'user-data');
}
