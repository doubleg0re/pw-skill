// state.ts — Pending user-action state persistence
// Stores overlay configuration per session+tabId so it can be
// re-injected after navigation or tab switch.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';

export interface PendingAction {
  tabId: number;
  prompt: string;
  actions: string[];
  focus?: string;
  createdAt: string;
}

interface StateFile {
  pending: PendingAction[];
}

function statePath(sessionName: string): string {
  return join(homedir(), '.playwright-state', 'sessions', sessionName, 'pending-actions.json');
}

export function loadPending(sessionName: string): PendingAction[] {
  const path = statePath(sessionName);
  if (!existsSync(path)) return [];
  try {
    const data: StateFile = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(data.pending) ? data.pending : [];
  } catch {
    return [];
  }
}

export function savePending(sessionName: string, pending: PendingAction[]): void {
  const path = statePath(sessionName);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteJSON(path, { pending });
}

export function addPending(sessionName: string, action: PendingAction): void {
  const lockPath = join(dirname(statePath(sessionName)), '.pending-actions.lock');
  simpleLock(lockPath);
  try {
    const list = loadPending(sessionName);
    const filtered = list.filter(p => p.tabId !== action.tabId);
    filtered.push(action);
    savePending(sessionName, filtered);
  } finally {
    simpleUnlock(lockPath);
  }
}

export function removePending(sessionName: string, tabId: number): void {
  const lockPath = join(dirname(statePath(sessionName)), '.pending-actions.lock');
  simpleLock(lockPath);
  try {
    const list = loadPending(sessionName);
    savePending(sessionName, list.filter(p => p.tabId !== tabId));
  } finally {
    simpleUnlock(lockPath);
  }
}

export function getPending(sessionName: string, tabId: number): PendingAction | undefined {
  return loadPending(sessionName).find(p => p.tabId === tabId);
}

export function clearAll(sessionName: string): void {
  savePending(sessionName, []);
}

// Simple file lock (self-contained, no core dependency)
function simpleLock(lockPath: string): void {
  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch {
      // Lock exists — wait and retry
      const sleep = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end); };
      sleep(50);
    }
  }
  // Force acquire after retries (stale lock)
  writeFileSync(lockPath, String(process.pid));
}

function simpleUnlock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch {}
}

function atomicWriteJSON(filePath: string, data: unknown): void {
  const tmp = join(dirname(filePath), `.tmp-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try { unlinkSync(filePath); } catch {}
  renameSync(tmp, filePath);
}
