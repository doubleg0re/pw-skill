// safe-mode.ts — opt-in restricted mode for delegating `pw` to agents (issue #1).
//
// Resolved ONCE from `PW_SAFE` env or the `--safe` flag and never turned off
// afterwards: an agent driving pw cannot lift it mid-session. There is no
// "unsafe" override on purpose. The operator sets PW_SAFE in the agent's
// environment (same trust model as spawning a subagent with a fixed toolset);
// if the operator also hands the agent a shell, env can be unset — that is the
// operator's responsibility, documented, not something pw can enforce.
import { resolve, sep } from 'path';

/** Pure resolver — which signal (if any) turns safe mode on. */
export function safeModeFrom(env: Record<string, string | undefined>, argv: string[]): 'env' | 'flag' | null {
  if (env.PW_SAFE === '1' || env.PW_SAFE === 'true') return 'env';
  if (argv.includes('--safe')) return 'flag';
  return null;
}

let cached: { on: boolean; reason: 'env' | 'flag' | null } | undefined;

function state(): { on: boolean; reason: 'env' | 'flag' | null } {
  if (!cached) {
    const reason = safeModeFrom(process.env, process.argv);
    cached = { on: reason !== null, reason };
  }
  return cached;
}

export function isSafeMode(): boolean {
  return state().on;
}
export function safeModeReason(): 'env' | 'flag' | null {
  return state().reason;
}

export class SafeModeError extends Error {
  constructor(public feature: string) {
    super(`${feature} is unavailable in safe mode (PW_SAFE). Relaunch pw without safe mode to use it.`);
    this.name = 'SafeModeError';
  }
}

/** Throw if `feature` (an escape hatch) is used while safe mode is on. */
export function assertAllowedInSafeMode(feature: string): void {
  if (isSafeMode()) throw new SafeModeError(feature);
}

// --- Navigation scheme allowlist (safe mode) ---
const SAFE_SCHEMES = new Set(['http:', 'https:', 'about:']);

/** Whether a URL's scheme is permitted in safe mode (blocks file://, chrome://, …). */
export function isSchemeAllowed(url: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false; // unparseable → reject
  }
}

// --- Output-root path confinement (safe mode) ---
/**
 * Whether `path` stays inside `root`. CLI paths are resolved relative to `cwd`
 * (the process working dir), so `.playwright-state/x` lands in the root while a
 * bare `page.html` or `/etc/passwd` or `../x` does not.
 */
export function isPathWithinRoot(path: string, root: string, cwd: string = process.cwd()): boolean {
  const r = resolve(root);
  const p = resolve(cwd, path);
  return p === r || p.startsWith(r + sep);
}
