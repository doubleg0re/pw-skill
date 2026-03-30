// session.ts — Global session manager with dependency injection
// Sessions live in {globalDir}/sessions/{name}/
// Local project state lives in {localDir}/.playwright-state/
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { atomicWriteJSON } from './file-utils.js';
import { acquireLock, releaseLock } from './lock.js';

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
  screenshotDir?: string;
}

export interface SessionStoreOptions {
  globalDir: string;
  localDir: string;
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
        ...(screenshotDir ? { screenshotDir } : {}),
      };

      const lockPath = join(dir, '.lock');
      acquireLock(lockPath, 'createSession');
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
      acquireLock(lockPath, 'updateSession');
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
    },

    unbindSession(): void {
      const bindFile = join(opts.localDir, 'current-session.txt');
      if (existsSync(bindFile)) unlinkSync(bindFile);
    },

    // --- Resolution ---

    resolveSession(sessionFlag?: string): SessionInfo {
      // 1. Explicit --session
      if (sessionFlag) {
        const session = this.getSession(sessionFlag);
        if (!session) throw new Error(`Session "${sessionFlag}" not found`);
        if (!isProcessAlive(session.pid)) throw new Error(`Session "${sessionFlag}" is not running (pid ${session.pid} dead)`);
        return session;
      }

      // 2. Bound session (pw use)
      const bound = this.getBoundSession();
      if (bound) {
        const session = this.getSession(bound);
        if (session && isProcessAlive(session.pid)) return session;
      }

      // 3. Only one alive session → auto-select
      const alive = this.listSessions().filter(s => isProcessAlive(s.pid));
      if (alive.length === 1) return alive[0];
      if (alive.length === 0) throw new Error('No active sessions. Run `pw launch` first.');
      throw new Error(
        `Multiple active sessions. Specify --session=<name> or run \`pw use <name>\`.\n` +
        `Active: ${alive.map(s => s.name).join(', ')}`
      );
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
export const resolveSession = defaultStore.resolveSession.bind(defaultStore);
export const sessionUserDataDir = defaultStore.sessionUserDataDir.bind(defaultStore);
export const hasProfile = defaultStore.hasProfile.bind(defaultStore);
export const globalSessionDir = defaultStore.globalSessionDir.bind(defaultStore);
export function localStateDir(cwd?: string): string {
  return cwd ? join(cwd, '.playwright-state') : defaultStore.localDir;
}
