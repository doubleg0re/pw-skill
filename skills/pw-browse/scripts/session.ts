// session.ts — Global session manager
// Sessions live in ~/.playwright-state/sessions/{name}/
// Local project state lives in {cwd}/.playwright-state/
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

// --- Paths ---

const GLOBAL_STATE_DIR = join(homedir(), '.playwright-state');
const GLOBAL_SESSIONS_DIR = join(GLOBAL_STATE_DIR, 'sessions');

export function localStateDir(cwd?: string): string {
  return join(cwd || process.cwd(), '.playwright-state');
}

export function globalSessionDir(name: string): string {
  return join(GLOBAL_SESSIONS_DIR, name);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Session Types ---

export interface SessionInfo {
  id: string;
  name: string;
  port: number;
  pid: number;
  startedAt: string;
  video: string | null;
}

// --- ID Generation ---

export function generateSessionId(): string {
  return randomBytes(4).toString('hex'); // 8 char hex
}

// --- Session CRUD ---

export function createSession(name: string, port: number, pid: number, video: string | null = null): SessionInfo {
  const sessionDir = globalSessionDir(name);
  ensureDir(sessionDir);
  ensureDir(join(sessionDir, 'user-data'));

  const session: SessionInfo = {
    id: generateSessionId(),
    name,
    port,
    pid,
    startedAt: new Date().toISOString(),
    video,
  };

  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(session, null, 2));
  return session;
}

export function getSession(name: string): SessionInfo | null {
  const metaFile = join(globalSessionDir(name), 'session.json');
  if (!existsSync(metaFile)) return null;
  try {
    return JSON.parse(readFileSync(metaFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function updateSession(name: string, updates: Partial<SessionInfo>): void {
  const session = getSession(name);
  if (!session) return;
  const updated = { ...session, ...updates };
  writeFileSync(join(globalSessionDir(name), 'session.json'), JSON.stringify(updated, null, 2));
}

export function deleteSession(name: string, keepProfile: boolean = true): void {
  const sessionDir = globalSessionDir(name);
  if (!existsSync(sessionDir)) return;
  if (keepProfile) {
    // Only remove session.json, keep user-data for --resume
    const metaFile = join(sessionDir, 'session.json');
    if (existsSync(metaFile)) unlinkSync(metaFile);
  } else {
    rmSync(sessionDir, { recursive: true, force: true });
  }
}

export function listSessions(): SessionInfo[] {
  ensureDir(GLOBAL_SESSIONS_DIR);
  const dirs = readdirSync(GLOBAL_SESSIONS_DIR);
  const sessions: SessionInfo[] = [];
  for (const dir of dirs) {
    const session = getSession(dir);
    if (session) sessions.push(session);
  }
  return sessions;
}

// --- Session Liveness ---

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

export function isSessionAlive(name: string): boolean {
  const session = getSession(name);
  if (!session) return false;
  return isProcessAlive(session.pid);
}

/** Find and clean up dead sessions (process gone but session.json remains) */
export function cleanupDeadSessions(): string[] {
  const cleaned: string[] = [];
  for (const session of listSessions()) {
    if (!isProcessAlive(session.pid)) {
      deleteSession(session.name, true); // keep profile for resume
      cleaned.push(session.name);
    }
  }
  return cleaned;
}

// --- Session Resolution ---

/** Get the bound session for current project (from current-session.txt) */
export function getBoundSession(cwd?: string): string | null {
  const bindFile = join(localStateDir(cwd), 'current-session.txt');
  if (!existsSync(bindFile)) return null;
  return readFileSync(bindFile, 'utf-8').trim() || null;
}

/** Bind a session to current project */
export function bindSession(name: string, cwd?: string): void {
  const stateDir = localStateDir(cwd);
  ensureDir(stateDir);
  writeFileSync(join(stateDir, 'current-session.txt'), name);
}

/** Unbind session from current project */
export function unbindSession(cwd?: string): void {
  const bindFile = join(localStateDir(cwd), 'current-session.txt');
  if (existsSync(bindFile)) unlinkSync(bindFile);
}

/**
 * Resolve which session to use.
 * Priority: --session flag → current-session.txt → only one alive → error
 */
export function resolveSession(sessionFlag?: string, cwd?: string): SessionInfo {
  // 1. Explicit --session
  if (sessionFlag) {
    const session = getSession(sessionFlag);
    if (!session) throw new Error(`Session "${sessionFlag}" not found`);
    if (!isProcessAlive(session.pid)) throw new Error(`Session "${sessionFlag}" is not running (pid ${session.pid} dead)`);
    return session;
  }

  // 2. Bound session (pw use)
  const bound = getBoundSession(cwd);
  if (bound) {
    const session = getSession(bound);
    if (session && isProcessAlive(session.pid)) return session;
    // Bound session is dead — fall through
  }

  // 3. Only one alive session → auto-select
  const alive = listSessions().filter(s => isProcessAlive(s.pid));
  if (alive.length === 1) return alive[0];
  if (alive.length === 0) throw new Error('No active sessions. Run `pw launch` first.');
  throw new Error(
    `Multiple active sessions. Specify --session=<name> or run \`pw use <name>\`.\n` +
    `Active: ${alive.map(s => s.name).join(', ')}`
  );
}

// --- Profile (user-data) ---

export function sessionUserDataDir(name: string): string {
  const dir = join(globalSessionDir(name), 'user-data');
  ensureDir(dir);
  return dir;
}

/** Check if a session profile exists (for --resume) */
export function hasProfile(name: string): boolean {
  return existsSync(join(globalSessionDir(name), 'user-data'));
}
