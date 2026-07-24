// git-exclude.ts — Keep pw's local .playwright-state/ out of the host project's
// git status by registering it in that repo's local exclude (.git/info/exclude).
// Local-only (never committed), worktree-aware, best-effort.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const EXCLUDE_ENTRY = '.playwright-state/';

// Pure: given the current exclude file contents, return the text to append,
// or null when the entry is already listed (so no write is needed).
export function computeExcludeAppend(current: string, entry: string): string | null {
  const already = current.split(/\r?\n/).some(line => line.trim() === entry);
  if (already) return null;
  const needsNewline = current.length > 0 && !current.endsWith('\n');
  return `${needsNewline ? '\n' : ''}${entry}\n`;
}

// Resolve the repo's local exclude file for a given directory, handling
// worktrees and subdirectories via `git rev-parse --git-common-dir`.
// Returns null when the directory is not inside a git repo.
export function resolveGitExcludeFile(projectDir: string): string | null {
  const res = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: projectDir,
    encoding: 'utf-8',
  });
  if (res.status !== 0 || !res.stdout) return null;
  const commonDir = resolve(projectDir, res.stdout.trim());
  return join(commonDir, 'info', 'exclude');
}

// Ensure `.playwright-state/` is excluded in the repo containing `projectDir`.
// Silently does nothing outside a git repo or on any I/O error.
export function ensureStateDirGitExcluded(projectDir: string): void {
  try {
    const excludeFile = resolveGitExcludeFile(projectDir);
    if (!excludeFile) return;

    const current = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf-8') : '';
    const append = computeExcludeAppend(current, EXCLUDE_ENTRY);
    if (append === null) return;

    const infoDir = dirname(excludeFile);
    if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true });
    appendFileSync(excludeFile, append);
  } catch {
    // Best-effort: keeping git status clean must never block a pw command.
  }
}
