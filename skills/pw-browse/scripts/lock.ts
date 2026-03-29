// lock.ts — File-based locking for cross-process coordination
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteJSON, readJSONSafe } from './file-utils.js';
import { isProcessAlive } from './session.js';

const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface LockInfo {
  pid: number;
  createdAt: string;
  updatedAt: string;
  operation?: string;
}

export type LockStatus = 'active' | 'stale' | 'orphan' | 'uncertain' | 'free';

export interface LockCheckResult {
  status: LockStatus;
  lock?: LockInfo;
  reason?: string;
}

/**
 * Attempt to acquire a lock file.
 * Returns true if acquired, false if already held by another active process.
 * Automatically cleans stale locks.
 */
export function acquireLock(lockPath: string, operation?: string): boolean {
  const dir = dirname(lockPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Check existing lock
  const existing = checkLock(lockPath);

  if (existing.status === 'active') {
    // Someone else holds it
    return false;
  }

  if (existing.status === 'uncertain') {
    // Can't be sure — don't force
    return false;
  }

  // Free, stale, or orphan — safe to take
  if (existing.status === 'stale' || existing.status === 'orphan') {
    releaseLock(lockPath); // clean up first
  }

  const now = new Date().toISOString();
  const lock: LockInfo = {
    pid: process.pid,
    createdAt: now,
    updatedAt: now,
    ...(operation ? { operation } : {}),
  };

  atomicWriteJSON(lockPath, lock);
  return true;
}

/**
 * Release a lock file.
 */
export function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
}

/**
 * Refresh lock heartbeat (update updatedAt).
 */
export function refreshLock(lockPath: string): boolean {
  const lock = readJSONSafe<LockInfo>(lockPath);
  if (!lock || lock.pid !== process.pid) return false;

  lock.updatedAt = new Date().toISOString();
  atomicWriteJSON(lockPath, lock);
  return true;
}

/**
 * Check lock status without modifying.
 */
export function checkLock(lockPath: string, staleTtlMs: number = DEFAULT_STALE_TTL_MS): LockCheckResult {
  const lock = readJSONSafe<LockInfo>(lockPath);

  if (!lock) {
    return { status: 'free' };
  }

  const pidAlive = isProcessAlive(lock.pid);
  const updatedAt = new Date(lock.updatedAt).getTime();
  const age = Date.now() - updatedAt;

  // PID dead → stale
  if (!pidAlive) {
    return { status: 'stale', lock, reason: `pid ${lock.pid} dead` };
  }

  // PID alive but lock is very old → uncertain (PID recycling risk)
  if (age > staleTtlMs) {
    return { status: 'uncertain', lock, reason: `pid ${lock.pid} alive but lock age ${Math.round(age / 1000)}s exceeds TTL` };
  }

  // PID alive and lock is fresh → active
  if (lock.pid === process.pid) {
    // Our own lock
    return { status: 'active', lock, reason: 'own process' };
  }

  return { status: 'active', lock, reason: `pid ${lock.pid} alive` };
}

/**
 * Execute a function while holding a lock.
 * Automatically acquires and releases.
 */
export async function withLock<T>(
  lockPath: string,
  operation: string,
  fn: () => T | Promise<T>,
  retries: number = 3,
  retryDelayMs: number = 100,
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (acquireLock(lockPath, operation)) {
      try {
        return await fn();
      } finally {
        releaseLock(lockPath);
      }
    }
    if (attempt < retries - 1) {
      await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw new Error(`Failed to acquire lock "${lockPath}" after ${retries} attempts (operation: ${operation})`);
}
