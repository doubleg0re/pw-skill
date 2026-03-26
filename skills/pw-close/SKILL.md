---
name: pw-close
description: Close and clean up Playwright browser. Triggered by "close browser", "quit playwright", or auto-called after pw-test completes.
---

# Playwright Browser Close

Terminate the browser process and clean up temporary files.

## Triggers

- When the user requests to close the browser
- Auto-called after `pw-test` completes

## Steps

### 1. Terminate browser process

Read the port from `.playwright-state/cdp-port.txt` and kill only the process using that port:

**macOS / Linux:**
```bash
CDP_PORT=$(cat .playwright-state/cdp-port.txt 2>/dev/null)
if [ -n "$CDP_PORT" ]; then
  lsof -ti :$CDP_PORT | xargs kill 2>/dev/null || true
fi
rm -f .playwright-state/cdp-port.txt
```

**Windows:**
```bash
CDP_PORT=$(cat .playwright-state/cdp-port.txt 2>/dev/null)
if [ -n "$CDP_PORT" ]; then
  cmd.exe /c "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :$CDP_PORT') do taskkill /PID %a /F 2>nul"
fi
rm -f .playwright-state/cdp-port.txt
```

> Note: `pw close` command handles platform detection automatically.

### 2. Preserve storageState

`.playwright-state/state.json` is kept (can be reused in the next session).
If the user explicitly requests deletion:

```bash
rm -rf .playwright-state/
```

### 3. Clean up temporary scripts

Clean up temporary scripts in the `scripts/playwright/` directory (those not explicitly created by the user).
Confirm with the user before cleaning up.

## Chaining

This is a terminal skill — no further chaining after completion.
