import { existsSync } from 'fs';
import { extname, isAbsolute, join, resolve } from 'path';

const RUNNABLE_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs', '.mts', '.cts'] as const;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function withExtensions(basePath: string): string[] {
  if (extname(basePath)) return [basePath];
  return RUNNABLE_EXTENSIONS.map(ext => `${basePath}${ext}`);
}

export function buildRunScriptCandidates(input: string, cwd: string = process.cwd()): string[] {
  if (!input) return [];

  if (isAbsolute(input) || input.startsWith('.') || input.includes('/')) {
    return unique(withExtensions(resolve(cwd, input)));
  }

  return unique([
    ...withExtensions(join(cwd, 'scripts', 'playwright', input)),
    ...withExtensions(resolve(cwd, input)),
  ]);
}

export function resolveRunScriptPath(input: string, cwd: string = process.cwd()): string | null {
  return buildRunScriptCandidates(input, cwd).find(existsSync) ?? null;
}
