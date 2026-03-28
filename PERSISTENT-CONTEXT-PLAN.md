# Persistent Context Plan

## Problem

`launchServer()` rejects `--user-data-dir` as a Chrome arg. This means:
- Session profiles (cookies, cache, service workers, IndexedDB) don't persist across browser restarts
- `pw launch --resume=dev` gets a clean browser, only restoring cookies via `storageState`
- README claims about "isolated per-session profiles" are overstated

## Goal

Each named session gets a real Chrome profile directory that survives browser restarts.
`--resume` should feel like reopening the same browser — not just replaying cookies.

## Current Architecture

```
browser-server.ts
  → chromium.launchServer({ args: ['--remote-debugging-port=N'] })
  → Playwright manages its own temp profile
  → Profile deleted when server closes

common.ts / session-commands.ts
  → chromium.connectOverCDP(cdpEndpoint) for DOM persistence
  → storageState save/load for cookie persistence
  → user-data-dir passed but never used
```

## Proposed Architecture

```
browser-server.ts
  → chromium.launchPersistentContext(userDataDir, { ... })
  → Chrome uses session-specific profile directory
  → Profile survives server restart

  → Separately: get CDP endpoint from the launched browser
  → Output { cdpEndpoint, pid } to stdout (same as now)

common.ts
  → connectOverCDP(cdpEndpoint) — same as now, DOM persistence works
  → storageState still saved as backup, but profile is the primary
```

## Key Change: launchPersistentContext

```typescript
// browser-server.ts — proposed
import { chromium } from 'playwright';

const headless = process.argv.includes('--headless');
const userDataDir = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice(17);
const cdpPort = await findFreePort();

const context = await chromium.launchPersistentContext(userDataDir || '', {
  headless,
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
  ],
});

// launchPersistentContext returns a BrowserContext, not a BrowserServer
// The browser process stays alive as long as this script runs (detached)
const browser = context.browser()!;
```

### Differences from launchServer

| | launchServer | launchPersistentContext |
|---|---|---|
| Returns | BrowserServer (ws endpoint) | BrowserContext |
| Profile | Temp, auto-deleted | Persistent, user-specified |
| PW WebSocket | Yes | No |
| CDP available | Via --remote-debugging-port | Via --remote-debugging-port |
| Context management | Client creates contexts | One persistent context provided |
| Multiple contexts | Yes | No (one fixed context) |

### Implications

1. **No PW WebSocket fallback** — We lose `chromium.connect(wsEndpoint)`. CDP-only.
   - This is fine — CDP is already the primary path and works.

2. **Single context per session** — `launchPersistentContext` gives one context.
   - This matches our usage — one session = one context.
   - Video recording needs a separate approach (can't create new context with recordVideo).

3. **No launchServer process management** — We need to keep the Node process alive ourselves.
   - Already doing this — browser-server.ts runs detached and stays alive.

4. **CDP endpoint discovery** — Need to find the CDP port after launch.
   - Same approach as now: `--remote-debugging-port=N` + poll `/json/version`.

## Implementation Steps

### Step 1: browser-server.ts

```typescript
import { chromium } from 'playwright';
import { createServer } from 'net';

const headless = process.argv.includes('--headless');
const userDataDir = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice(17) || '';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

(async () => {
  const cdpPort = await findFreePort();

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
    ],
  });

  const pid = process.pid;

  // Wait for CDP to be ready
  let cdpEndpoint = '';
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${cdpPort}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      const json = await res.json();
      if (json.webSocketDebuggerUrl) {
        cdpEndpoint = json.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  process.stdout.write(JSON.stringify({ cdpEndpoint, pid }) + '\n');

  // Keep alive
  process.on('SIGTERM', async () => {
    await context.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await context.close();
    process.exit(0);
  });
})();
```

### Step 2: common.ts — launchBrowserServer

- Remove `wsEndpoint` from return type (CDP-only)
- Pass `userDataDir` to browser-server.ts (re-enable the arg)
- `connectBrowser` only uses `connectOverCDP`
- Remove PW WebSocket fallback path

### Step 3: session.ts — SessionInfo

- Remove `wsEndpoint` field (or keep as optional for backward compat)
- `cdpEndpoint` becomes the primary connection field

### Step 4: session-commands.ts

- Launch uses `userDataDir` from `sessionUserDataDir(name)`
- Connect via CDP only
- Remove `chromium.connect(wsEndpoint)` fallback

### Step 5: Video recording

Since `launchPersistentContext` doesn't support creating new contexts with `recordVideo`:

Option A: Use CDP's `Page.startScreencast` for frame capture (complex)
Option B: Use `context.tracing` instead of video (simpler, already have trace support)
Option C: Launch a SEPARATE non-persistent browser for video sessions

Recommended: **Option C** — When `--video` is requested, fall back to `launchServer` (temp profile). This is an acceptable trade-off: video recording sessions don't need profile persistence.

```typescript
if (opts.video) {
  // Video needs launchServer (temp profile, but that's OK for recordings)
  return launchWithServer(opts);
} else {
  // Normal: persistent context with real profile
  return launchWithPersistentContext(opts);
}
```

### Step 6: Tests

- Update session tests for cdpEndpoint-only
- E2E test: launch → close → resume → verify profile data persists
- E2E test: IndexedDB data survives restart

## Migration

### Breaking Changes

- `wsEndpoint` removed from SessionInfo (or deprecated)
- PW WebSocket fallback removed
- Video recording sessions use temp profiles

### Non-Breaking

- CLI interface unchanged
- `--session`, `pw use`, `pw close` all same
- `storageState` still saved as backup
- CDP connection logic same (just no fallback)

## Directory Structure (unchanged)

```
~/.playwright-state/
  sessions/
    dev/
      session.json          # { cdpEndpoint, pid, ... }
      user-data/            # REAL Chrome profile (now actually used!)
        Default/
          Cookies
          Local Storage/
          Service Worker/
          Cache/
          ...
```

## Risks

1. **Windows headed** — `launchPersistentContext` may have same issues as original `spawn` approach.
   Need to test. If it fails, browser-server.ts as detached process should still work.

2. **CDP stability** — Single connection path, no fallback. If CDP fails, no recovery.
   Mitigation: retry logic + clear error messages.

3. **Profile corruption** — If browser crashes, profile may be in inconsistent state.
   Mitigation: `storageState` backup is still there as fallback.

4. **Profile size** — Real Chrome profiles can grow large (cache, etc.).
   Mitigation: Document that `pw rary destroy` or manual cleanup may be needed.

## Summary

Replace `launchServer` with `launchPersistentContext` in browser-server.ts.
CDP becomes the only connection method (already the primary path).
Each session gets a real Chrome profile that survives restarts.
Video recording falls back to temp profiles (acceptable trade-off).
`storageState` remains as backup for edge cases.
