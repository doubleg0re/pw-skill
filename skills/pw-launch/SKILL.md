---
name: pw-launch
description: Launch Playwright browser. Triggered by "open browser", "launch page", "start playwright", or auto-called when pw-browse/pw-test detects browser is not running.
---

# Playwright Browser Launch

Launch the browser and initialize a named session.

## Triggers

- When the user requests to launch a browser
- When `pw-browse` or `pw-test` detects the browser is not running (auto-chaining)

## Primary Command

```bash
npx tsx ~/.claude/skills/pw-browse/scripts/pw.ts launch [url] [flags]
```

This is the standard way to start a browser session. The `pw launch` command handles installation checks, session creation, and optional navigation in one step.

### Flags

| Flag | Description |
|------|-------------|
| `--name=N` | Name the session (default: auto-generated `s-<id>`) |
| `--resume=N` | Resume a previous session by name (reuses user-data profile) |
| `--headed` | Show the browser window (default: headless) |
| `--video[=name]` | Enable video recording; optional name for auto-rename on close |
| `--viewport=WxH` | Viewport size (default: `auto`, resolved from the current screen) |

### Examples

```bash
# Launch headless, auto-named
pw launch http://localhost:3000

# Named session, headed, with video
pw launch http://localhost:3000 --name=dev --headed --video=login-flow

# Resume a previous session (reuses cookies/profile)
pw launch --resume=dev
```

## Session Management

Sessions are stored globally at `~/.playwright-state/sessions/{name}/`. Each session has:
- `session.json` — PID, port, metadata
- `user-data/` — Chromium profile (persists across resume)

After launch, the session is automatically bound to the current project via `pw use`. This means all subsequent `pw` commands in the project target this session without needing `--session`.

### Bind a session manually

```bash
pw use <name>          # Bind session to current project
pw use                 # Show current binding
pw sessions            # List all sessions
```

## Manual bootstrap for `@playwright/test`

> These steps are **only** for users who want to run tests with the official
> `@playwright/test` runner (e.g. `npx playwright test tests/e2e/*.spec.ts`).
> The `pw launch` CLI itself does **not** create `playwright.config.ts` or
> initialize `.playwright-state/` — it manages its own CDP sessions. If you
> only use `pw` / `pwi` / `pw sequence`, skip this whole section.

### 1. Check playwright installation

```bash
npx playwright --version || npx playwright install chromium
```

### 2. Check playwright.config.ts

If `playwright.config.ts` does not exist at the project root, create it:

```bash
cat > playwright.config.ts << 'PWEOF'
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    storageState: '.playwright-state/state.json',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
PWEOF
```

### 3. Initialize state directory

```bash
mkdir -p .playwright-state/screenshots
```

### 4. Add to .gitignore

If `.playwright-state/` is not in `.gitignore`, add it.

### Defaults

| Option | Default | Override |
|--------|---------|----------|
| headless | `true` | Add `--headed` flag |
| browser | chromium | (chromium only for now) |
| viewport | `auto` (resolved from current screen) | Add `--viewport=WxH` flag |

### If headless fails

If a test fails in headless mode, retry with the `--headed` flag.

## Chaining

After this skill completes, resume the original request (pw-browse or pw-test).
