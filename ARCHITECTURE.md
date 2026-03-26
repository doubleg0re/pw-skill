# Session Architecture — Future Plan

## Current State
- Single browser per project (cwd)
- `.playwright-state/cdp-port.txt` — port only, no PID
- No multi-session, no cross-project sharing
- Zombie browser processes possible

## Phase 1 — PID Management (next)
- `cdp-port.txt` → `session.json` with `{ port, pid, startedAt, video }`
- Close uses PID for reliable kill
- Status checks process liveness via PID
- Zombie detection and cleanup

## Phase 2 — Multi-Session + Global Sessions

### Directory Structure
```
~/.playwright-state/                    # Global — browser processes, profiles
  sessions/
    dev/
      session.json                      # { id, name, port, pid, video, startedAt }
      user-data/                        # Chrome profile (cookies, login)
    staging/
      session.json
      user-data/

{project}/.playwright-state/            # Local — artifacts
  current-session.txt                   # Bound session name (from `pw use`)
  screenshots/
  videos/
  traces/
  console.log
  network.log
```

### Session Lifecycle
```bash
# Create (global)
pw launch http://localhost:3000 --name=dev     # → { id: "a1b2c3", name: "dev" }
pw launch http://localhost:3000                 # → { id: "d4e5f6", name: null } (auto ID)

# Bind to project (local)
pw use dev                                      # writes current-session.txt

# Work (auto-resolves session)
pw click "#btn"                                 # uses bound session
pw click "#btn" --session=staging               # explicit override

# Session resolution order:
# 1. --session=name flag
# 2. current-session.txt (from pw use)
# 3. Only one session exists → auto-select
# 4. Error: multiple sessions, specify --session

# Resume (reuse profile after close)
pw launch --resume=dev                          # same user-data, new process
pw launch --resume=dev http://other.com         # resume + different URL

# Close
pw close                                        # close bound session
pw close --session=dev                          # close specific
pw close --all                                  # close all sessions
```

### Cross-Project Sharing
```bash
# Project A (worktree 1)
pw launch http://localhost:3000 --name=dev
pw use dev
pw fill "#email" "admin@test.com"
pw click "#login"
# Now "dev" session is logged in

# Project B (worktree 2)
pw use dev                          # same browser, same login
pw screenshot                       # saved to project B's local screenshots/
```

### Multi-Context per Session (future)
```bash
pw ctx create admin --session=dev
pw ctx create guest --session=dev
pw click "#btn" --session=dev --ctx=admin
pw click "#btn" --session=dev --ctx=guest
```

## Design Principles
- Global state = browser processes + user profiles (shared)
- Local state = artifacts (screenshots, logs, traces — per project)
- Explicit > implicit — `pw use` makes binding visible
- No --session when only one → zero friction for simple use
- PID-based process management — no zombie browsers
