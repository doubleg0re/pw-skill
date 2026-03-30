# pw-skill

Playwright CLI Skill for Claude Code. Persistent browser sessions, modular skills, token-efficient, full flow engine.

## Why not MCP?

| | MCP | pw-skill |
|---|---|---|
| Token cost | ~3,500+ tokens always loaded | ~850 tokens per skill, only when needed |
| Browser session | New browser per action | Persistent via CDP, named sessions |
| Session management | None | Named sessions with isolated profiles |
| Debug tools | None | Console, network, trace, video |
| Tab management | None | Full tab control |
| Flow engine | None | Sequence with variables, conditions, loops |
| CLI access | No | `pw` command (35+ subcommands) |

## Install

### Claude Code Plugin (recommended)

```bash
/plugin marketplace add doubleg0re/pw-skill
/plugin install pw-skill@pw-skill
cd ~/.claude/plugins/marketplaces/pw-skill/skills/pw-browse/scripts
npm run setup
```

### npm (CLI only)

```bash
npm install -g pw-skill
```

This installs the CLI only. It does not register the Claude Code skills by itself.

If you still want the skill-oriented guidance from the terminal, use:

```bash
pw agent skill --all
pw agent skill --browse
pw agent skill --launch
pw agent skill --test
pw agent skill --close
```

### Manual

```bash
git clone https://github.com/doubleg0re/pw-skill.git
cp -r pw-skill/skills/pw-* ~/.claude/skills/
cd ~/.claude/skills/pw-browse/scripts && npm install && npx playwright install chromium
```

## Quick Start

```bash
# Launch a named browser session
pw launch --name=dev

# Navigate and interact
pw navigate http://localhost:3000 --screenshot
pw fill "#email" "admin@test.com"
pw fill "#password" "secret"
pw click "Sign in"
pw wait /dashboard

# Observe
pw screenshot --full
pw console dump

# Close when done
pw close --session=dev
```

## Choose Your Lane

If you just want to do something quickly, use `pwi`.

- `pwi` is the lightest entry point: launch, do the action, exit.
- Good for quick inspection, one-off clicks, screenshots, and tiny experiments.
- Handy aliases: `nav`=`navigate`, `shot`=`screenshot`, `sel`=`select`, `eval`=`evaluate`.

```bash
pwi nav https://example.com --screenshot
pwi dump --selector="h1" --text
```

If you want lightweight browser automation, use `pw seq|sequence`.

- `pw seq|sequence` is the next step up: structured multi-step runs with variables, branching, loops, and reusable flow files.
- Good when one-shot commands stop being enough, but you do not want to build extensions yet.

```bash
pw seq ./login-flow.json
pw seq '[{"nav":"https://example.com"},{"action":"click","args":["#login"]}]'
```

If you want advanced runtime behavior, use `rary`.

- `rary` is for extensions, hooks, event handlers, sidecars, and custom sequence actions.
- Use it when you want to grow beyond the built-in runtime and attach new capabilities to `pw`.

```bash
pw rary get <repo-or-path>
pw rary put <package-name>
```

## For Agents

If `pw-skill` is installed as a CLI but not registered as a Claude Code skill, the terminal can still print compact skill summaries:

```bash
pw agent skill --all
pw agent skill --browse
pw agent skill --launch
pw agent skill --test
pw agent skill --close
```

These are compact CLI-facing summaries of the `pw-browse`, `pw-launch`, `pw-test`, and `pw-close` skill docs.

## One-shot Mode (`pwi`)

`pwi` launches a temporary browser, executes the action(s), and exits. No sessions, no CDP server, no hooks, no extensions. Just Playwright directly.

```bash
# One-shot: launches browser → executes → closes
pwi navigate https://example.com --screenshot
pwi dump --selector="h1" --text
pwi navigate url :: click "#login" :: screenshot

# Options
pwi navigate url --headed          # show browser window
pwi navigate url --viewport=800x600
```

No `pw launch` needed. For session-based persistent work, use `pw` instead.

| Command | Browser | Session | Hooks/Extensions |
|---------|---------|---------|------------------|
| `pwi action` | temporary, auto-closes | none | none |
| `pw action` | persistent via CDP | required | loaded |
| `pw a :: b` | persistent via CDP | required | loaded |

Chaining is restricted to browser actions only. Session, admin, and package commands (`launch`, `close`, `rary`, etc.) are not chainable.

## Extensions

pw-skill uses a lightweight extension system called `rary`. Extensions can add event handlers, hooks, and custom sequence actions.

```bash
# Install and activate an extension
pw rary get <repo-or-path>
pw rary yoink <repo-or-path>  # Alias for get
pw rary put <package-name>

# List installed extensions
pw rary toybox

# Deactivate
pw rary ignore <package-name>
pw rary snub <package-name>   # Alias for ignore
```

### Built-in Extensions

| Extension | Description |
|---|---|
| `pw-monitor` | Real-time tab monitor — CDP WebSocket sidecar tracks tabs, emits `tab:*` events, powers GUI dashboard |
| `pw-persist-user-action` | Persists user-action overlay state across navigation — re-injects overlay on tab change |

### Extension Dependencies in Flows

Flows can declare required extensions via `info.requiresRary`:

```json
{
  "info": {
    "name": "login-flow",
    "requiresRary": ["pw-monitor"]
  },
  "flow": [
    { "action": "navigate", "args": ["https://example.com/login"] }
  ]
}
```

Missing extensions fail fast with a clear error. CLI override: `pw sequence flow.json --rary=pw-monitor`.

## Execution Model

### pw vs pwi

| | `pw` | `pwi` |
|---|---|---|
| Browser | Persistent (CDP server, named session) | Temporary (launches, executes, closes) |
| Requires `pw launch` | Yes | No |
| Session management | Full (named, resumable, multi-session) | None |
| Extensions/hooks | Loaded every command | None |
| Use case | Ongoing work, complex flows | Quick one-shot tasks |

### Session Resolution (`pw` commands)

When you run a `pw` command, the session is resolved in this order:

1. **`--session=name`** — Explicit flag. If the named session doesn't exist or is dead, error.
2. **Bound session** — Via `pw use <name>`. If the bound session is dead, falls through.
3. **Auto-select** — If exactly one session is alive, use it.
4. **No session** — Auto-launches a new session.
5. **Multiple sessions** — Error: "Specify `--session=<name>` or run `pw use <name>`."

### Global Flags

| Flag | Where it applies | Effect |
|------|-----------------|--------|
| `--session=N` | `pw` commands only | Target a specific named session |
| `--tab=N` | `pw` commands only | Target a specific tab (default: 0) |
| `--headed` | `pw` and `pwi` | Show browser window |
| `--viewport=WxH` | `pw` and `pwi` | Set viewport size (default: 1920x1080) |
| `--video[=name]` | `pw` commands only | Enable video recording |
| `--screenshot` | `pw` and `pwi` | Take screenshot after action |
| `--screenshot-path=dir` | `pw launch` | Pin session screenshots to a stable directory |
| `--no-restore` | `pw` commands only | Don't restore last URL on reconnect |

### What happens on each `pw` command

```
pw navigate url
 │
 ├─ 1. Session resolution (see above)
 ├─ 2. CDP reconnect (reuses existing browser/page/DOM)
 ├─ 3. --tab selection (if specified)
 ├─ 4. Load extension event handlers
 ├─ 5. Build runtime context (session, page, tabId, emitEvent)
 ├─ 6. Run extension load hooks (e.g., pw-monitor tab sync)
 ├─ 7. Execute the action
 └─ 8. Output JSON result
```

### What happens on each `pwi` command

```
pwi navigate url
 │
 ├─ 1. chromium.launch() — temporary browser
 ├─ 2. Execute the action(s)
 ├─ 3. Output JSON result
 └─ 4. browser.close() — browser gone
```

### Error & Recovery

| Situation | Behavior |
|-----------|----------|
| `--session=ghost` (doesn't exist) | Error: "Session not found" |
| `--session=dead` (PID dead) | Error: "Session not running" |
| Bound session died | Falls through to auto-select |
| No sessions at all | Auto-launches a new one |
| CDP reconnect fails | Tries WebSocket fallback |
| Session profile exists but no session.json | `pw launch --resume=name` to restart |

## Session Management

Sessions are the core of pw-skill. Each session is a named, persistent Chromium process with its own user-data directory stored globally at `~/.playwright-state/sessions/`.

```bash
# Launch a named session
pw launch --name=dev
pw launch --name=staging --headed

# Resume a previous session (reuses cookies, localStorage, profile)
pw launch --resume=dev

# Bind a session to the current project
pw use dev

# List all sessions (shows name, port, pid, status)
pw sessions

# Close a specific session
pw close --session=dev

# Close all sessions
pw close --all
```

Session resolution order:
1. Explicit `--session=name` flag on any command
2. Bound session via `pw use`
3. Auto-select if only one session is alive

Multiple sessions can run simultaneously. Each gets isolated user-data, so login state and cookies never bleed between sessions.

## CLI Reference

### Navigation

| Command | Description |
|---|---|
| `pw nav\|navigate <url> [--screenshot]` | Go to URL |
| `pw refresh\|reload [--screenshot]` | Reload current page |

### Interaction

| Command | Description |
|---|---|
| `pw click <selector\|text\|x,y>` | Click element |
| `pw dblclick <selector\|text\|x,y>` | Double-click element |
| `pw hover <selector\|text>` | Hover (tooltips, menus) |
| `pw drag <source> <target>` | Drag and drop (selector or coordinates) |
| `pw scroll <up\|down\|top\|bottom\|selector\|px>` | Scroll page |
| `pw fill <selector> <text>` | Click + fill input |
| `pw type <text> [--delay=ms]` | Type on keyboard |
| `pw sel\|select <selector> (--value=x\|--label=x\|--index=n)` | Select dropdown option |
| `pw upload <selector> <file...>` | Upload file(s) |
| `pw submit [selector] [--wait=/url]` | Submit form (Enter or selector) |
| `pw submit --url=/api/x --method=POST --body='{}'` | Direct HTTP form submission |
| `pw download <target> [--async] [--dir=path]` | Download file (sync or async) |
| `pw download status` | Check pending downloads |
| `pw download list` | List downloaded files |
| `pw paste` | Paste (Ctrl+V at current focus) |
| `pw paste [selector] --text="hello"` | Set clipboard and paste text |
| `pw paste [selector] --image=./photo.png` | Paste image |

### Observation

| Command | Description |
|---|---|
| `pw shot\|screenshot` | Capture viewport |
| `pw shot\|screenshot --full` | Capture full page |
| `pw shot\|screenshot <selector>` | Capture element |
| `pw shot\|screenshot <x,y,w,h>` | Capture coordinate region |
| `pw shot\|screenshot --name=login` | Custom screenshot filename |
| `pw copy <selector> [--format=text\|html\|outer\|image]` | Copy text/HTML/image from element. `--format=image` copies element to clipboard as PNG + saves file. `--save-only` to skip clipboard. |
| `pw find <selector> [--detail=tag\|class\|full]` | Query DOM elements |
| `pw attr <selector> <name> [--set=value]` | Read/write DOM attribute |
| `pw eval\|evaluate <js-expression>` | Execute JavaScript in page |
| `pw wait <ms\|HH:MM\|/url\|selector>` | Wait for condition |
| `pw wait <selector> --attr=textContent --value=Done` | Wait for attribute value |

Screenshots default to `./.playwright-state/screenshots` under the current working directory. For session-based work, `pw launch --screenshot-path=dir` pins the screenshot directory in session metadata so later commands keep writing there even if `cwd` changes.

### HTTP

| Command | Description |
|---|---|
| `pw fetch GET /api/projects` | HTTP GET with browser auth |
| `pw fetch POST /api/projects '{"name":"test"}'` | HTTP POST with browser auth |
| `pw fetch PUT\|DELETE\|PATCH ...` | All standard methods supported |

### Automation

| Command | Description |
|---|---|
| `pw sequence <json-string\|file>` | Run action sequence (see Flow Engine below) |

### Session & Tabs

| Command | Description |
|---|---|
| `pw launch [url] [--name=N] [--resume=N] [--screenshot-path=dir]` | Launch browser session |
| `pw use <name>` | Bind session to project (freely switches, returns previous binding if any) |
| `pw sessions` | List all sessions |
| `pw close [--session=N] [--all]` | Close session(s) |
| `pw tab new [url]` | Open new tab |
| `pw tab list` | List open tabs |
| `pw tab close <index>` | Close tab |
| `pw status` | Session status (pages, URL, title) |

> **Caution for AI agents:** Unless the user explicitly asks to close every session, avoid using `--all`. Other agents or background tasks may have active sessions you do not know about. Prefer plain `pw close` to safely terminate the current bound session.

### Debugging

| Command | Description |
|---|---|
| `pw console inject` | Inject console capture |
| `pw console dump [+include] [-exclude] [/regex/]` | Dump console logs |
| `pw console tail [+include] [-exclude]` | Show last 20 log lines |
| `pw console clear` | Clear captured logs |
| `pw network inject` | Inject network capture |
| `pw network dump [+include] [-exclude] [/regex/]` | Dump network logs |
| `pw network tail` | Show last 20 network entries |
| `pw network find /api` | Search network logs |
| `pw network clear` | Clear captured logs |
| `pw trace start [--screenshots] [--snapshots]` | Start trace recording |
| `pw trace stop [--name=flow-name]` | Stop and save trace |
| `pw trace view [name]` | Open trace viewer |
| `pw trace status` | Check recording status |
| `pw video list` | List recorded videos |
| `pw video path` | Current recording path |
| `pw video rename latest <name>` | Rename a video |
| `pw video clear` | Delete all videos |

### Global Flags

All commands support these flags:

```
--session=N    Target specific session
--tab=N        Target specific tab (default: 0)
--headed       Show browser window
--viewport=WxH Viewport size (default: 1920x1080)
--video[=name] Enable video recording
--raw          Bypass truncation/masking in console/network dump
```

## Sequence Flow Engine

Sequence is a full flow engine that runs JSON action lists with variables, branching, loops, and functions.

> Full syntax reference for AI generation: [SEQUENCE-SYNTAX.md](SEQUENCE-SYNTAX.md)

```bash
pw sequence ./login-flow.json
pw sequence '[{"action":"navigate","args":["http://localhost:3000"]}]'
pw sequence flow.json --allow-shell
pw sequence flow.json --params '{"url":"https://example.com","user":"admin"}'
pw sequence flow.json --params ./params/prod.json
pw sequence flow.json --rary=pw-monitor
```

### Variables

Store action results and interpolate them in later steps:

```json
[
  {"action": "fetch", "args": ["GET", "/api/user"], "out": "user"},
  {"action": "log", "text": "User: {{user.name}}"},
  {"action": "fill", "args": ["#name", "{{user.name}}"]}
]
```

Special variables: `{{$index}}`, `{{$key}}`, `{{$error}}`, `{{$errorType}}`

Ephemeral registers: `{{$ret}}` (last action result), `{{$err}}` (last error message), `{{$code}}` (last exit/status code), `{{$elem}}` (last matched element)

### Args Format

Args accept both array and object format:

```json
{"action": "fill", "args": ["#email", "admin@test.com"]}
{"action": "fill", "args": {"selector": "#email", "value": "admin@test.com"}}
```

### Condition

Branch based on variable values. Supports `eq`, `neq`, `gt`, `lt`, `contains`, `exists`. Composite with `and`/`or`:

```json
{
  "action": "condition",
  "ref": "user.role",
  "eq": "admin",
  "then": [{"action": "navigate", "args": ["/admin"]}],
  "else": [{"action": "navigate", "args": ["/dashboard"]}]
}
```

### Each

Iterate over arrays or objects. Supports `{k,v}` destructuring for objects:

```json
{"action": "each", "ref": "items", "as": "item", "items": [
  {"action": "log", "text": "{{item.name}}"}
]}
```

### Loop

Condition-based loop. `{{$index}}` available (0-based):

```json
{"action": "loop", "condition": {"ref": "$index", "lt": 5}, "items": [
  {"action": "click", "args": [".next-page"]}
]}
```

`count` also supported (backward compat).

### Label / Goto

Jump to labeled steps (max 100 jumps to prevent infinite loops):

```json
[
  {"label": "start"},
  {"action": "click", "args": [".retry"]},
  {"action": "wait", "args": ["1000"]},
  {"action": "goto", "label": "start"}
]
```

### Def / Call

Define reusable functions (`type: "func"`, default) and conditions (`type: "condition"`):

```json
[
  {"action": "def", "name": "login", "type": "func", "params": ["email", "pass"], "items": [
    {"action": "fill", "args": ["#email", "{{email}}"]},
    {"action": "fill", "args": ["#password", "{{pass}}"]},
    {"action": "click", "args": ["Sign in"]}
  ]},
  {"action": "call", "name": "login", "args": ["admin@test.com", "secret"]}
]
```

Condition defs are used in `catch:<name>`:
```json
{"action": "def", "name": "authFail", "type": "condition", "items": [
  {"ref": "$url", "contains": "/login"}
]}
```

### Try / Catch / Finally

```json
{"action": "try", "items": [
  {"action": "click", "args": ["Sign in"]}
], "catch:challenge": [
  {"action": "wait", "args": ["user-action"], "prompt": "Solve challenge"}
], "catch": [
  {"action": "log", "text": "Error: {{$error}}"}
], "finally": [
  {"action": "screenshot"}
]}
```

### Shell

Execute local commands (requires `--allow-shell`):

```json
{"action": "shell", "args": ["node", "scripts/seed.js"], "out": "result"}
```

Result: `{exitCode, stdout, stderr}`. Use `--request-permission` for user approval prompts.

### Set

Copy values into user-defined variables:

```json
{"action": "set", "items": {"savedRet": {"ref": "$ret"}, "count": {"value": 3}}}
```

Each entry must contain exactly one of `ref` or `value`. Destination names cannot start with `$`.

### Wait — Observation Targets

Watch a target and complete when `trigger` matches. Supports `dom:<selector>`, `dom:<selector>[field]`, `url:<pattern>`, and `challenge`:

```json
{"action": "wait", "target": "dom:#status[textContent]", "trigger": {"ref": "$changed", "eq": true}, "timeout": 10000, "out": "watch"}
```

### Wait User-Action

Pause with action buttons. Supports `focus` (selector to focus) and `idle` (ms before showing buttons) for semi-assisted input:

```json
{"action": "wait", "target": "user-action", "prompt": "Choose", "actions": ["approve", "skip"], "out": "choice"}
```

### Wait User-Alert

Show an informational overlay (no action buttons, auto-dismiss):

```json
{"action": "wait", "target": "user-alert", "prompt": "Please submit the form manually."}
```

### Log

Print variable values for debugging:

```json
{"action": "log", "ref": "user"},
{"action": "log", "text": "Count: {{items.length}}"},
{"action": "log"}
```

## Debugging

### Trace Recording

Record Playwright traces for step-by-step debugging with screenshots, DOM snapshots, and network:

```bash
pw trace start --screenshots --snapshots
# ... perform actions ...
pw trace stop --name=login-flow
pw trace view login-flow
```

### Video Recording

Record browser sessions as video. Enable via the `--video` flag on any command:

```bash
pw navigate http://localhost:3000 --video=signup-flow
# ... perform actions ...
pw close  # video auto-saved and renamed
pw video list
```

### Console Capture

Patches `console.*` in the browser to capture logs across CDP disconnects:

```bash
pw console inject
pw console dump                    # all logs
pw console dump +error             # only lines containing "error"
pw console dump -verbose           # exclude "verbose"
pw console dump +/api/ -/health/   # regex include/exclude
pw console dump --raw              # no truncation
pw console tail +error             # last 20 matching lines
```

### Network Capture

Patches `fetch` and `XMLHttpRequest` to capture all network traffic:

```bash
pw network inject
pw network dump                    # all requests
pw network dump --raw              # no truncation or masking
pw network find /api/users         # search by URL pattern
```

### Sensitive Data Masking

Network and console dumps automatically mask sensitive data:
- **Headers**: `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`
- **JSON fields**: `password`, `token`, `secret`, `api_key`, `access_token`, `refresh_token`

Use `--raw` to bypass masking when you need full output.

### Error Context

When a command fails, pw-skill automatically captures:
- Current URL and page title
- Active tab index and session name
- Error screenshot saved to `.playwright-state/screenshots/`

## Package Management (rary)

<p align="center">
  <img src="larry.png" alt="Larry the Cat — Larry's Live-rary" width="280" />
</p>

Larry the Cat's package and extension ecosystem. Install, inspect, activate, and manage browser add-ons.

```bash
# Install a package
pw rary get doubleg0re/pw-persistws
pw rary yoink doubleg0re/pw-persistws   # Alias for get
pw rary get ./local-package

# Inspect
pw rary toybox            # List installed packages
pw rary peek <package>    # Show package details

# Activate/deactivate extensions
pw rary put <package>     # Activate extension (runs hooks on launch/close)
pw rary ignore <package>  # Deactivate without removing
pw rary snub <package>    # Alias for ignore

# Setup and maintenance
pw rary rolling <package> # Run first-time setup
pw rary need-repair       # Check for broken packages
pw rary destroy <package> # Remove package (alias: kick)
```

Packages live in `~/.playwright-state/toybox/`. Each package has a `larry.json` manifest defining commands, hooks (launch/load/close), and setup entries.

Extension hooks integrate with session lifecycle:
- `launch` hooks run after `pw launch`
- `close` hooks run before `pw close`

## Custom Scripts

Write project-specific scripts in `scripts/playwright/`. They are auto-discovered by `pw`:

```typescript
// scripts/playwright/login.ts
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];

await page.goto('http://localhost:3000/login');
await page.locator('#email').fill('admin@test.com');
await page.locator('#password').fill('password');
await page.locator('button[type="submit"]').click();
await page.waitForURL('**/dashboard');

console.log(JSON.stringify({ success: true, url: page.url() }));
```

```bash
pw login  # auto-discovers scripts/playwright/login.ts
```

Local scripts in `scripts/playwright/` override global scripts with the same name.

## Architecture

```
~/.playwright-state/              # Global state
  sessions/
    dev/
      session.json                # {id, name, port, pid, startedAt, video}
      user-data/                  # Isolated Chromium profile
    staging/
      session.json
      user-data/
  toybox/                         # Installed packages (rary)
    package-name/
      larry.json                  # Package manifest
  extensions.json                 # Active extension registry

<project>/.playwright-state/      # Local state (per project)
  current-session.txt             # Bound session name (pw use)
  state.json                      # storageState
  screenshots/
  videos/
  traces/
  console.log
  network.log

pw-skill/
  .claude-plugin/                 # Claude Code plugin metadata
  skills/
    pw-launch/SKILL.md
    pw-browse/
      SKILL.md
      scripts/                    # 35+ files
        pw.ts                     # CLI entry point
        common.ts                 # Shared: connect, run wrapper, flags, screenshotPath
        session.ts                # Global session store (DI-based)
        session-commands.ts       # launch/use/sessions/close implementations
        pwi.ts                    # One-shot runner (temporary browser, no sessions)
        actions.ts                # Shared action module (CLI + sequence)
        sequence.ts               # Flow engine + requiresRary
        runtime.ts                # Extension Runtime SDK
        tab-registry.ts           # Stable tab identity + TAB_EVENTS contract
        trace.ts                  # Trace recording
        video.ts                  # Video management
        video-utils.ts            # Video rename helpers
        navigate.ts, click.ts, dblclick.ts, hover.ts, drag.ts,
        scroll.ts, fill.ts, type.ts, select.ts, upload.ts,
        submit.ts, screenshot.ts, copy.ts, find.ts, attr.ts,
        evaluate.ts, wait.ts, fetch.ts, console.ts, network.ts,
        tab.ts, status.ts
    pw-test/SKILL.md
    pw-close/SKILL.md
  extensions/
    pw-monitor/                   # Real-time tab monitor (CDP sidecar + GUI)
    pw-persist-user-action/       # Overlay persistence across navigation
  tests/                          # 325 tests (vitest)
  package.json
```

### Key Design Decisions

- **Persistent browser with DOM state**: Chromium stays alive via `launchServer` + CDP. On reconnect, the existing context and page are reused — DOM state, scroll position, JS variables, and in-progress form data are all preserved. Cookies and localStorage persist via `storageState`.
- **Global sessions, local state**: Session processes and profiles live in `~/.playwright-state/` (shared across projects). Screenshots, logs, and bindings are per-project.
- **Shared action module**: `actions.ts` provides one implementation used by both CLI scripts and the sequence engine. No duplication.
- **Safe arg passing**: CLI uses `spawnSync` with argument arrays, never shell string concatenation.
- **4 modular skills**: Only the relevant skill loads into Claude's context. Zero tokens when idle.
- **Console/Network inject**: Patches browser globals to capture logs even between CDP disconnects.
- **Browser auth in HTTP**: `fetch` and `submit` use browser cookies, so API calls are authenticated automatically.
- **Windows compatible**: Uses `taskkill` for session close on Windows.
- **Whitelist security redaction**: Network dumps only show safe headers (content-type, accept, etc.). Bodies summarized by default. `--raw` for full debug. `--verbose` for richer summaries.
- **File-based locking**: Cross-process session locks with stale detection (5min TTL), heartbeat for long operations, atomic JSON writes.
- **$ref resolution**: `{ "$ref": "path" }` preserves types in sequence args. `{ "$literal": ... }` for escape. Depth-limited.
- **Error diagnostics**: Failed commands auto-capture URL, title, tab, session name, and an error screenshot.
- **Extension Runtime SDK**: `ExtensionRuntimeContext` gives extensions session info, `cdpEndpoint`, `emitEvent()`, lazy browser/page access, and `registerCleanup()`. Extensions can register custom sequence actions, event handlers, and build persistent monitors — all without making core heavy.
- **Extension sequence actions**: Active rary extensions can register custom actions in `larry.json` that become first-class sequence DSL actions. Custom action names must include a hyphen, for example `persist-user-action`, so they stay visually distinct from built-ins. Per-run merged map, built-in collision rejection.
- **One-shot mode (`pwi`)**: Launches a temporary browser, executes action(s), and exits. No sessions, no CDP server, no hooks. For quick tasks without `pw launch`.
- **Stable tab events**: `TAB_EVENTS` constants with canonical `TabEventPayload`. Core and extensions follow the same contract. Cross-contract tests enforce consistency.
- **requiresRary**: Flows declare extension dependencies via `info.requiresRary`. Missing extensions fail fast. CLI `--rary=name` also supported.
- **DI-based stores**: Session and rary stores use factory pattern (`createSessionStore`, `createRaryStore`) for testability.
- **Standardized result schema**: All environment-dependent operations report `warnings: string[]` array and consistent status fields.

## Core vs Extensions

pw-skill keeps the core runtime lightweight.

The core provides browser/session capabilities, runtime context, and event bridges.
Heavier runtime features such as persistent monitors, sidecars, GUI overlays, and advanced event streaming are intended to live in rary extensions rather than the core runtime.

In short:
- core = thin runtime platform
- extensions = optional runtime products

See [Core and Extension Runtime Guide](docs/CORE-AND-EXTENSION-RUNTIME-GUIDE.md).

## Tests

325 tests using vitest, covering session management, sequence flow engine (incl. requiresRary), variable interpolation, console/network filtering, action dispatch, rary store operations, file locking, error result assembly, connect edge cases, runtime SDK, event contract validation, tab sync (pw-monitor), pending action state (pw-persist-user-action), and settings.

```bash
npm test           # run all tests
npm run test:watch # watch mode
```

## Comparison

> Comparison as of March 2026. Features may have changed.

| | pw-skill | lackeyjb | willmarple |
|---|---|---|---|
| Token loading | On-demand (4 modular skills) | Always loaded (single skill) | Always loaded (single skill) |
| Browser session | Persistent via CDP, named sessions with isolated profiles | New browser per action | Playwright CLI sessions |
| Flow engine | Full (variables, conditions, loops, functions, goto) | None | None |
| Debug tooling | Console/network capture, trace recording, video | None | Playwright CLI passthrough |
| Authenticated HTTP | `fetch`/`submit` reuse browser cookies | None | None |
| Platform | Windows + Linux + macOS | Linux/macOS | Linux/macOS |

## License

MIT
