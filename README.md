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
| `pw navigate <url> [--screenshot]` | Go to URL |

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
| `pw select <selector> [--value\|--label\|--index]` | Select dropdown option |
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
| `pw screenshot` | Capture viewport |
| `pw screenshot --full` | Capture full page |
| `pw screenshot <selector>` | Capture element |
| `pw screenshot <x,y,w,h>` | Capture coordinate region |
| `pw screenshot --name=login` | Custom screenshot filename |
| `pw copy <selector> [--format=text\|html\|outer\|image]` | Copy text/HTML/image from element. `--format=image` copies element to clipboard as PNG + saves file. `--save-only` to skip clipboard. |
| `pw find <selector> [--detail=tag\|class\|full]` | Query DOM elements |
| `pw attr <selector> <name> [--set=value]` | Read/write DOM attribute |
| `pw evaluate <js-expression>` | Execute JavaScript in page |
| `pw wait <ms\|HH:MM\|/url\|selector>` | Wait for condition |
| `pw wait <selector> --attr=textContent --value=Done` | Wait for attribute value |

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
| `pw launch [url] [--name=N] [--resume=N]` | Launch browser session |
| `pw use <name>` | Bind session to project |
| `pw sessions` | List all sessions |
| `pw close [--session=N] [--all]` | Close session(s) |
| `pw tab new [url]` | Open new tab |
| `pw tab list` | List open tabs |
| `pw tab close <index>` | Close tab |
| `pw status` | Session status (pages, URL, title) |

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

```bash
pw sequence ./login-flow.json
pw sequence '[{"action":"navigate","args":["http://localhost:3000"]}]'
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

### Args Format

Args accept both array and object format:

```json
{"action": "fill", "args": ["#email", "admin@test.com"]}
{"action": "fill", "args": {"selector": "#email", "value": "admin@test.com"}}
```

### Condition

Branch based on variable values. Supports `eq`, `neq`, `gt`, `lt`, `contains`, `exists`:

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
{"action": "fetch", "args": ["GET", "/api/items"], "out": "items"},
{
  "action": "each",
  "ref": "items",
  "as": "item",
  "do": [{"action": "log", "text": "{{item.name}}"}]
}
```

Object iteration with destructure:

```json
{
  "action": "each",
  "ref": "config",
  "as": "{k, v}",
  "do": [{"action": "log", "text": "{{k}} = {{v}}"}]
}
```

### Loop

Repeat N times. `{{$index}}` available in body:

```json
{"action": "loop", "count": 3, "do": [
  {"action": "click", "args": [".next-page"]}
]}
```

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

Define reusable functions with parameters:

```json
[
  {"action": "def", "name": "login", "params": ["email", "pass"], "do": [
    {"action": "fill", "args": ["#email", "{{email}}"]},
    {"action": "fill", "args": ["#password", "{{pass}}"]},
    {"action": "click", "args": ["Sign in"]}
  ]},
  {"action": "call", "name": "login", "args": ["admin@test.com", "secret"]},
  {"action": "call", "name": "login", "args": {"email": "user@test.com", "pass": "pw123"}}
]
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

Larry the Cat's package and extension ecosystem. Install, inspect, activate, and manage browser add-ons.

```bash
# Install a package
pw rary get doubleg0re/pw-persistws
pw rary get ./local-package

# Inspect
pw rary toybox            # List installed packages
pw rary peek <package>    # Show package details

# Activate/deactivate extensions
pw rary put <package>     # Activate extension (runs hooks on launch/close)
pw rary yoink <package>   # Deactivate without removing

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

Write project-specific scripts using `import { run } from 'pw-skill'`:

```typescript
// scripts/playwright/login.ts
import { run, screenshotPath } from 'pw-skill';

run(async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.locator('#email').fill('admin@test.com');
  await page.locator('#password').fill('password');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard');
  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path };
});
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
        actions.ts                # Shared action module (CLI + sequence)
        sequence.ts               # Flow engine
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
  tests/                          # 124 tests (vitest)
  package.json
```

### Key Design Decisions

- **CDP persistent browser**: Chromium stays alive across script invocations. DOM, JS state, scroll position, form data -- all preserved.
- **Global sessions, local state**: Session processes and profiles live in `~/.playwright-state/` (shared across projects). Screenshots, logs, and bindings are per-project.
- **Shared action module**: `actions.ts` provides one implementation used by both CLI scripts and the sequence engine. No duplication.
- **Safe arg passing**: CLI uses `spawnSync` with argument arrays, never shell string concatenation.
- **4 modular skills**: Only the relevant skill loads into Claude's context. Zero tokens when idle.
- **Console/Network inject**: Patches browser globals to capture logs even between CDP disconnects.
- **Browser auth in HTTP**: `fetch` and `submit` use browser cookies, so API calls are authenticated automatically.
- **Windows compatible**: Uses `taskkill` for session close on Windows.
- **Sensitive data masking**: Network and console dumps mask auth headers and credential fields by default.
- **Error diagnostics**: Failed commands auto-capture URL, title, tab, session name, and an error screenshot.
- **DI-based stores**: Session and rary stores use factory pattern (`createSessionStore`, `createRaryStore`) for testability.
- **Standardized result schema**: All environment-dependent operations report `warnings: string[]` array and consistent status fields.

## Tests

124 tests using vitest, covering session management, sequence flow engine, variable interpolation, console/network filtering, action dispatch, and rary store operations.

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
