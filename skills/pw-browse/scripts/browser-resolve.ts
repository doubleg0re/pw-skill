// browser-resolve.ts — map a browser request to Playwright launch options.
// Names resolve against the user's browser registry (browser-registry.ts) —
// there is no hardcoded browser list. `--executable` / `--channel` are escape
// hatches that bypass the registry.
import { existsSync } from 'fs';
import { readBrowserRegistry, type BrowserRegistry } from './browser-registry.js';

export interface BrowserSpec {
  browser?: string; // registered name
  executable?: string; // explicit binary path (wins over browser)
  channel?: string; // Playwright channel passthrough (e.g. "chrome", "msedge")
}

export interface ResolvedBrowser {
  executablePath?: string;
  channel?: string;
  /** Resolvable id persisted on the session/profile: registry name, exec path, or "channel:x". */
  name: string;
  /** Human label for display (falls back to name). */
  label: string;
  /** Default session name from the registry entry, if any. */
  defaultName?: string;
}

/**
 * Resolve a browser request to launch options, or `null` for "use the bundled
 * Chromium" (the default). Throws with a clear message when a requested
 * name/binary can't be resolved.
 */
export function resolveBrowserSpec(
  spec: BrowserSpec,
  opts: { registry?: BrowserRegistry; fileExists?: (p: string) => boolean } = {},
): ResolvedBrowser | null {
  const fileExists = opts.fileExists ?? existsSync;

  // Explicit executable path wins.
  if (spec.executable) {
    if (!fileExists(spec.executable)) throw new Error(`--executable path not found: ${spec.executable}`);
    return { executablePath: spec.executable, channel: spec.channel, name: spec.executable, label: spec.executable };
  }

  // Bare --channel (no --browser): pass straight to Playwright.
  if (spec.channel && !spec.browser) {
    return { channel: spec.channel, name: `channel:${spec.channel}`, label: `channel:${spec.channel}` };
  }

  // No browser (or explicit chromium) → bundled default.
  if (!spec.browser || spec.browser.toLowerCase() === 'chromium') return null;

  const registry = opts.registry ?? readBrowserRegistry();
  const entry = registry[spec.browser];
  if (!entry) {
    const known = Object.keys(registry);
    const hint = known.length ? ` Registered: ${known.join(', ')}.` : '';
    throw new Error(
      `Browser "${spec.browser}" is not registered.${hint} Register it with: pw browser register ${spec.browser} <path>  (or pass --executable=<path>).`,
    );
  }
  if (!fileExists(entry.path)) {
    throw new Error(
      `Registered browser "${spec.browser}" points at a missing binary: ${entry.path}. Re-register it: pw browser register ${spec.browser} <path>.`,
    );
  }
  return {
    executablePath: entry.path,
    channel: spec.channel,
    name: spec.browser,
    label: entry.label ?? spec.browser,
    defaultName: entry.defaultName,
  };
}

/**
 * Reverse of the persisted `session.browser` / profile.json id back into launch
 * options, so a resumed/relaunched session keeps its browser: a registry name,
 * an explicit path, or "channel:x".
 */
export function browserSpecFromStored(
  stored?: string,
  opts: { registry?: BrowserRegistry } = {},
): { executablePath?: string; channel?: string } | undefined {
  if (!stored) return undefined;
  if (stored.startsWith('/')) return { executablePath: stored };
  if (stored.startsWith('channel:')) return { channel: stored.slice('channel:'.length) };
  const registry = opts.registry ?? readBrowserRegistry();
  const entry = registry[stored];
  return entry ? { executablePath: entry.path } : undefined;
}
