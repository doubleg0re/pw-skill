// clean.ts — Safe cleanup of dead sessions, stale bindings, orphaned artifacts, broken packages
import {
  listSessions,
  isProcessAlive,
  deleteSession,
  getBoundSession,
  unbindSession,
  localStateDir,
} from './session.js';
import { existsSync, rmSync } from 'fs';
import { analyze } from './analyze.js';
import { releaseLock } from './lock.js';

export interface CleanResult {
  cleaned: {
    dead: string[];
    stale: string[];
    orphaned: string[];
    staleLocks: string[];
    orphanLocks: string[];
  };
}

export function cleanDead(): string[] {
  const cleaned: string[] = [];
  for (const session of listSessions()) {
    if (!isProcessAlive(session.pid)) {
      deleteSession(session.name, true); // keep user-data for resume
      cleaned.push(session.name);
    }
  }
  return cleaned;
}

export function cleanStale(cwd?: string): string[] {
  const cleaned: string[] = [];
  const bound = getBoundSession(cwd);
  if (bound) {
    const { getSession } = require('./session.js');
    const session = getSession(bound);
    if (!session || !isProcessAlive(session.pid)) {
      unbindSession(cwd);
      cleaned.push(bound);
    }
  }
  return cleaned;
}

export function cleanOrphans(cwd?: string): string[] {
  const cleaned: string[] = [];
  const diagnostics = analyze(cwd);

  for (const item of diagnostics.orphaned) {
    if (item.path && existsSync(item.path)) {
      try {
        rmSync(item.path, { force: true });
        cleaned.push(item.path);
      } catch {}
    }
  }
  return cleaned;
}

export function cleanStaleLocks(cwd?: string): string[] {
  const cleaned: string[] = [];
  const diagnostics = analyze(cwd);
  for (const item of diagnostics.staleLocks) {
    if (item.path) {
      releaseLock(item.path);
      cleaned.push(item.path);
    }
  }
  return cleaned;
}

export function cleanOrphanLocks(cwd?: string): string[] {
  const cleaned: string[] = [];
  const diagnostics = analyze(cwd);
  for (const item of diagnostics.orphanLocks) {
    if (item.path) {
      releaseLock(item.path);
      cleaned.push(item.path);
    }
  }
  return cleaned;
}

export function cleanAll(cwd?: string): CleanResult {
  return {
    cleaned: {
      dead: cleanDead(),
      stale: cleanStale(cwd),
      orphaned: cleanOrphans(cwd),
      staleLocks: cleanStaleLocks(cwd),
      orphanLocks: cleanOrphanLocks(cwd),
    },
  };
}
