// settings.ts — Project-level settings loader
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type RedactionLevel = 'strict' | 'verbose' | 'raw';

export interface PwSettings {
  redactionLevel?: RedactionLevel;
}

const VALID_LEVELS: RedactionLevel[] = ['strict', 'verbose', 'raw'];
const DEFAULT_LEVEL: RedactionLevel = 'strict';

/**
 * Load .pw-settings.json from project root.
 * Returns empty settings if file doesn't exist.
 */
export function loadPwSettings(cwd?: string): PwSettings {
  const dir = cwd || process.cwd();
  const filePath = join(dir, '.pw-settings.json');

  if (!existsSync(filePath)) return {};

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (raw.redactionLevel && !VALID_LEVELS.includes(raw.redactionLevel)) {
      process.stderr.write(`[pw] Warning: invalid redactionLevel "${raw.redactionLevel}" in .pw-settings.json. Using default "${DEFAULT_LEVEL}".\n`);
      return { ...raw, redactionLevel: undefined };
    }
    return raw;
  } catch {
    process.stderr.write(`[pw] Warning: malformed .pw-settings.json. Using defaults.\n`);
    return {};
  }
}

/**
 * Resolve effective redaction level.
 * Priority: CLI flag > .pw-settings.json > default
 */
export function resolveRedactionLevel(opts: {
  cwd?: string;
  cliRaw?: boolean;
  cliLevel?: string;
  defaultLevel?: RedactionLevel;
}): RedactionLevel {
  // 1. CLI explicit
  if (opts.cliRaw) return 'raw';
  if (opts.cliLevel) {
    if (VALID_LEVELS.includes(opts.cliLevel as RedactionLevel)) {
      return opts.cliLevel as RedactionLevel;
    }
    process.stderr.write(`[pw] Warning: invalid --redaction-level "${opts.cliLevel}". Using default.\n`);
  }

  // 2. Project settings
  const settings = loadPwSettings(opts.cwd);
  if (settings.redactionLevel) return settings.redactionLevel;

  // 3. Default
  return opts.defaultLevel || DEFAULT_LEVEL;
}
