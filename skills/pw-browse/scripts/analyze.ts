// analyze.ts — Read-only diagnostics for sessions, bindings, artifacts, and packages
import {
  listSessions,
  isProcessAlive,
  getBoundSession,
  getSession,
  localStateDir,
} from './session.js';
import { checkRepair } from './rary.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface AnalyzeItem {
  name: string;
  path?: string;
  reason?: string;
}

export interface AnalyzeResult {
  live: AnalyzeItem[];
  dead: AnalyzeItem[];
  stale: AnalyzeItem[];
  orphaned: AnalyzeItem[];
  broken: AnalyzeItem[];
}

export function analyze(cwd?: string): AnalyzeResult {
  const result: AnalyzeResult = {
    live: [],
    dead: [],
    stale: [],
    orphaned: [],
    broken: [],
  };

  // --- Sessions: live vs dead ---
  for (const session of listSessions()) {
    if (isProcessAlive(session.pid)) {
      result.live.push({ name: session.name, reason: `pid ${session.pid} alive` });
    } else {
      result.dead.push({ name: session.name, reason: `pid ${session.pid} dead` });
    }
  }

  // --- Stale binding ---
  const bound = getBoundSession(cwd);
  if (bound) {
    const session = getSession(bound);
    if (!session) {
      result.stale.push({ name: bound, path: join(localStateDir(cwd), 'current-session.txt'), reason: 'Bound session does not exist' });
    } else if (!isProcessAlive(session.pid)) {
      result.stale.push({ name: bound, path: join(localStateDir(cwd), 'current-session.txt'), reason: `Bound session "${bound}" is dead (pid ${session.pid})` });
    }
  }

  // --- Orphaned local artifacts ---
  const local = localStateDir(cwd);
  if (existsSync(local)) {
    const artifactDirs = ['screenshots', 'videos', 'traces', 'downloads'];
    for (const dir of artifactDirs) {
      const dirPath = join(local, dir);
      if (!existsSync(dirPath)) continue;
      const files = readdirSync(dirPath);
      if (files.length === 0) continue;

      // If no live sessions are bound to this project, artifacts are orphaned
      const hasLiveBinding = bound && getSession(bound) && isProcessAlive(getSession(bound)!.pid);
      if (!hasLiveBinding) {
        for (const file of files) {
          result.orphaned.push({
            name: file,
            path: join(dirPath, file),
            reason: `No active session bound — artifact in ${dir}/`,
          });
        }
      }
    }

    // Orphaned log files
    for (const logFile of ['console.log', 'network.log']) {
      const logPath = join(local, logFile);
      if (existsSync(logPath)) {
        const stat = statSync(logPath);
        if (stat.size > 0) {
          const hasLiveBinding = bound && getSession(bound) && isProcessAlive(getSession(bound)!.pid);
          if (!hasLiveBinding) {
            result.orphaned.push({ name: logFile, path: logPath, reason: 'No active session bound' });
          }
        }
      }
    }
  }

  // --- Broken rary packages ---
  const repairIssues = checkRepair();
  for (const issue of repairIssues) {
    result.broken.push({ name: issue.package, reason: issue.issue });
  }

  return result;
}
