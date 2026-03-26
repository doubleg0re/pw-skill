---
name: pw-close
description: Close and clean up Playwright browser. Triggered by "close browser", "quit playwright", or auto-called after pw-test completes.
---

# Playwright Browser Close

Terminate the browser process and clean up temporary files.

## Triggers

- When the user requests to close the browser
- Auto-called after `pw-test` completes

## Primary Command

```bash
npx tsx ~/.claude/skills/pw-browse/scripts/pw.ts close [flags]
```

### Flags

| Flag | Description |
|------|-------------|
| `--session=N` | Close a specific named session |
| `--all` | Close all active sessions |

If no flag is provided, closes the bound session (via `pw use`) or the only active session.

## Steps

### 1. Terminate browser process (PID-based)

The `pw close` command reads `session.json` from `~/.playwright-state/sessions/{name}/` and kills the browser by PID. This works cross-platform (macOS, Linux, Windows).

- Sends `SIGTERM` first, waits 500ms
- Falls back to `SIGKILL` on Unix if the process survives
- Reports actionable error if the process refuses to terminate

### 2. Auto-rename video on close

If `--video=name` was used during launch, the recorded `.webm` file is automatically renamed from the Playwright-generated UUID to the specified name before session cleanup.

### 3. Clean up session metadata

- `session.json` is removed from `~/.playwright-state/sessions/{name}/`
- `user-data/` profile directory is preserved (allows `pw launch --resume=N`)
- Project binding (`current-session.txt`) is cleared if this was the bound session

### 4. Preserve storageState

`.playwright-state/state.json` is kept (can be reused in the next session).
If the user explicitly requests deletion:

```bash
rm -rf .playwright-state/
```

### 5. Clean up temporary scripts

Clean up temporary scripts in the `scripts/playwright/` directory (those not explicitly created by the user).
Confirm with the user before cleaning up.

## Examples

```bash
pw close                   # Close bound/only session
pw close --session=dev     # Close specific session
pw close --all             # Close all sessions
```

## Chaining

This is a terminal skill — no further chaining after completion.
