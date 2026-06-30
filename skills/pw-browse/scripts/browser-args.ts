// browser-args.ts — Chromium launch args for the detached browser server.
// Kept dependency-free so the detached server process stays lean.

// Default window size for headless. With viewport:null ("auto"), the page
// follows the window; headless has no real window, so without this it falls
// back to Chromium's 800x600. Overridable per-session via `--viewport=WxH`.
export const DEFAULT_HEADLESS_WINDOW = { width: 1440, height: 900 };

export function buildChromiumArgs(headless: boolean, cdpPort: number): string[] {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    ...(headless ? [`--window-size=${DEFAULT_HEADLESS_WINDOW.width},${DEFAULT_HEADLESS_WINDOW.height}`] : []),
  ];
}
