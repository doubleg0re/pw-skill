// analyze.ts — Read-only diagnostics for sessions, bindings, artifacts, and packages
import {
  listSessions,
  isProcessAlive,
  getBoundSession,
  getSession,
  localStateDir,
} from './session.js';
import { checkRepair } from './rary.js';
import { checkLock } from './lock.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
  dormantProfiles: AnalyzeItem[];
  broken: AnalyzeItem[];
  activeLocks: AnalyzeItem[];
  staleLocks: AnalyzeItem[];
  orphanLocks: AnalyzeItem[];
  uncertainLocks: AnalyzeItem[];
}

export function analyze(cwd?: string): AnalyzeResult {
  const result: AnalyzeResult = {
    live: [],
    dead: [],
    stale: [],
    orphaned: [],
    dormantProfiles: [],
    broken: [],
    activeLocks: [],
    staleLocks: [],
    orphanLocks: [],
    uncertainLocks: [],
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

  // --- Lock health ---
  const globalSessions = join(homedir(), '.playwright-state', 'sessions');
  if (existsSync(globalSessions)) {
    for (const name of readdirSync(globalSessions)) {
      const lockPath = join(globalSessions, name, '.lock');
      if (!existsSync(lockPath)) continue;

      const lockStatus = checkLock(lockPath);
      const item: AnalyzeItem = {
        name,
        path: lockPath,
        reason: lockStatus.reason || lockStatus.status,
      };

      const sessionExists = existsSync(join(globalSessions, name, 'session.json'));

      if (!sessionExists) {
        result.orphanLocks.push({ ...item, reason: 'Lock exists but session does not' });
      } else if (lockStatus.status === 'active') {
        result.activeLocks.push(item);
      } else if (lockStatus.status === 'stale') {
        result.staleLocks.push(item);
      } else if (lockStatus.status === 'uncertain') {
        result.uncertainLocks.push(item);
      }
    }
  }

  // Local lock files
  if (existsSync(local)) {
    for (const lockFile of ['.bind.lock', '.sequence.lock']) {
      const lockPath = join(local, lockFile);
      if (!existsSync(lockPath)) continue;

      const lockStatus = checkLock(lockPath);
      const item: AnalyzeItem = { name: lockFile, path: lockPath, reason: lockStatus.reason || lockStatus.status };

      if (lockStatus.status === 'active') result.activeLocks.push(item);
      else if (lockStatus.status === 'stale') result.staleLocks.push(item);
      else if (lockStatus.status === 'uncertain') result.uncertainLocks.push(item);
    }
  }

  // --- Dormant profiles (closed but persisted on disk) ---
  // sessions/<name>/ with a user-data dir but no session.json = a profile that
  // `pw close` left behind; invisible to `pw sessions`. Surface it so `pw clean
  // profiles` can reclaim the disk (or the user can relaunch it by name).
  if (existsSync(globalSessions)) {
    for (const entry of readdirSync(globalSessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(globalSessions, entry.name);
      const hasSession = existsSync(join(dir, 'session.json'));
      const hasUserData = existsSync(join(dir, 'user-data'));
      if (!hasSession && hasUserData) {
        result.dormantProfiles.push({ name: entry.name, path: dir, reason: 'Closed profile (no session.json) — reusable by name or removable' });
      }
    }
  }

  return result;
}
