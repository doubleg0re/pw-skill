// browser-resolve.ts — map a browser request (name / executable / channel) to
// Playwright launch options. Lets pw drive the user's real Chromium-family
// browser (Brave/Chrome/Edge) instead of the bundled Chromium. macOS app paths
// for now; `--executable` overrides for anything else.
//
// Kept pure (fs access injected) so it stays unit-testable.
import { existsSync } from 'fs';

export interface BrowserSpec {
  browser?: string; // brave | chrome | edge | chromium
  executable?: string; // explicit binary path (wins over browser)
  channel?: string; // Playwright channel passthrough (e.g. "chrome", "msedge")
}

export interface ResolvedBrowser {
  executablePath?: string;
  channel?: string;
  /** Human label for messages and the session record. */
  label: string;
}

/** macOS Chromium-family app binaries, keyed by the `--browser` value. */
export const MAC_BROWSER_PATHS: Record<string, { path: string; label: string }> = {
  brave: { path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', label: 'Brave' },
  chrome: { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Chrome' },
  edge: { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', label: 'Edge' },
};

export const KNOWN_BROWSERS = [...Object.keys(MAC_BROWSER_PATHS), 'chromium'];

/**
 * Resolve a browser request to launch options, or `null` to mean "use the
 * bundled Chromium" (the default — unchanged behavior). Throws with a clear
 * message when an explicitly requested browser/binary is missing.
 */
export function resolveBrowserSpec(
  spec: BrowserSpec,
  fileExists: (p: string) => boolean = existsSync,
): ResolvedBrowser | null {
  // Explicit executable path wins.
  if (spec.executable) {
    if (!fileExists(spec.executable)) {
      throw new Error(`--executable path not found: ${spec.executable}`);
    }
    return { executablePath: spec.executable, channel: spec.channel, label: spec.executable };
  }

  // Bare --channel (no --browser): pass straight to Playwright.
  if (spec.channel && !spec.browser) {
    return { channel: spec.channel, label: `channel:${spec.channel}` };
  }

  // No browser (or explicit chromium) → bundled default.
  if (!spec.browser || spec.browser.toLowerCase() === 'chromium') {
    return null;
  }

  const key = spec.browser.toLowerCase();
  const known = MAC_BROWSER_PATHS[key];
  if (!known) {
    throw new Error(
      `Unknown --browser "${spec.browser}". Known: ${KNOWN_BROWSERS.join(', ')}. Or use --executable=<path>.`,
    );
  }
  if (!fileExists(known.path)) {
    throw new Error(`${known.label} not found at ${known.path}. Install it or pass --executable=<path>.`);
  }
  return { executablePath: known.path, channel: spec.channel, label: known.label };
}

/**
 * Reverse of the persisted `session.browser` label back into launch options, so
 * a resumed/auto-relaunched dead session keeps driving the same browser.
 */
export function browserSpecFromLabel(label?: string): { executablePath?: string; channel?: string } | undefined {
  if (!label) return undefined;
  if (label.startsWith('/')) return { executablePath: label };
  if (label.startsWith('channel:')) return { channel: label.slice('channel:'.length) };
  const entry = Object.values(MAC_BROWSER_PATHS).find(b => b.label === label);
  return entry ? { executablePath: entry.path } : undefined;
}
