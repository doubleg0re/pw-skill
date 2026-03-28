// clean.ts — Safe cleanup of dead sessions, stale bindings, orphaned artifacts, broken packages
import {
  listSessions,
  isProcessAlive,
  deleteSession,
  getBoundSession,
  unbindSession,
  localStateDir,
} from './session.js';
import { checkRepair, removePackage } from './rary.js';
import { existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { analyze, type AnalyzeResult } from './analyze.js';

export interface CleanResult {
  cleaned: {
    dead: string[];
    stale: string[];
    orphaned: string[];
    broken: string[];
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

export function cleanBroken(): string[] {
  const cleaned: string[] = [];
  const issues = checkRepair();

  // Group by package — only remove if package has issues
  const brokenPackages = new Set(issues.map(i => i.package));
  for (const pkg of brokenPackages) {
    removePackage(pkg);
    cleaned.push(pkg);
  }
  return cleaned;
}

export function cleanAll(cwd?: string): CleanResult {
  return {
    cleaned: {
      dead: cleanDead(),
      stale: cleanStale(cwd),
      orphaned: cleanOrphans(cwd),
      broken: cleanBroken(),
    },
  };
}
