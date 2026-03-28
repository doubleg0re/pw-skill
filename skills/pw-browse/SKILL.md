---
name: pw-browse
description: Playwright browser control. Use when browser interaction is needed — screenshots, clicks, input, navigation, etc. Triggered by "take a screenshot", "click the button", "go to this page", etc.
---

# Playwright Browser Control

Control the browser using general-purpose scripts.

## Triggers

- Requests for browser interaction: screenshots, clicks, input, navigation, etc.
- Situations requiring web page inspection or UI validation

## Prerequisites

If the `.playwright-state/` directory does not exist, invoke the `pw-launch` skill first.

## Script Lookup Order

1. `{project}/scripts/playwright/{name}.ts` (local — project-specific custom)
2. `~/.claude/skills/pw-browse/scripts/{name}.ts` (global — default)

If a script with the same name exists locally, the local version takes priority.

## Execution

```bash
# When local script exists
npx tsx scripts/playwright/{name}.ts [args...]

# Global fallback
npx tsx ~/.claude/skills/pw-browse/scripts/{name}.ts [args...]
```

## Global Flags

All scripts support the following flags:

| Flag | Description |
|------|-------------|
| `--session=N` | Target a specific named session (default: auto-resolved via `pw use` binding or single active session) |
| `--tab=N` | Target a specific tab (default: 0) |
| `--headed` | Show browser window |
| `--viewport=WxH` | Viewport size (default: 1920x1080) |
| `--video[=name]` | Enable video recording |

## General-purpose Script Reference (25 scripts)

### navigate.ts — Navigate to URL
```bash
npx tsx {script_path}/navigate.ts <url> [--screenshot] [--headed] [--viewport=WxH]
```

### screenshot.ts — Capture page
```bash
npx tsx {script_path}/screenshot.ts [target] [--full] [--name=filename] [--headed]
```
- No args: Capture current viewport
- `--full`: Full-page scroll capture
- `selector`: Capture a specific element (e.g., `#header`, `.card`)
- `x,y,width,height`: Capture a coordinate region (e.g., `100,200,500,300`)
- `--name=filename`: Custom screenshot filename (default: timestamp)

### click.ts — Click an element
```bash
npx tsx {script_path}/click.ts <target> [--mode=selector|text|coord]
```
- Auto-detection: `#id` `.class` → selector, `350,200` → coord, otherwise → text
- `--mode`: Explicitly specify mode

### dblclick.ts — Double-click an element
```bash
npx tsx {script_path}/dblclick.ts <target> [--mode=selector|text|coord]
```
- Same interface as click.ts, performs a double-click

### drag.ts — Drag and drop
```bash
npx tsx {script_path}/drag.ts <source> <target> [--mode=selector|coord]
```
- `--mode=selector`: dragTo between selectors (default)
- `--mode=coord`: Coordinate-based (e.g., `drag.ts 100,200 300,400 --mode=coord`)

### fill.ts — Click selector + type text
```bash
npx tsx {script_path}/fill.ts <selector> <text>
```

### type.ts — Type into current focus
```bash
npx tsx {script_path}/type.ts <text> [--delay=ms]
```
- Use after a click (click.ts → type.ts)

### hover.ts — Hover over an element
```bash
npx tsx {script_path}/hover.ts <target> [--mode=selector|text|coord]
```
- Same interface as click.ts, performs a hover

### scroll.ts — Scroll the page
```bash
npx tsx {script_path}/scroll.ts [selector] [--direction=down|up|left|right] [--amount=px]
```
- `selector`: Scroll within a specific element (omit for window scroll)
- `--direction`: Scroll direction (default: down)
- `--amount`: Scroll amount in pixels

### upload.ts — File upload
```bash
npx tsx {script_path}/upload.ts <selector> <file-path>
```
- `selector`: File input element selector
- `file-path`: Absolute or relative path to the file to upload

### submit.ts — Form submission (UI or direct HTTP)
```bash
npx tsx {script_path}/submit.ts [form-selector] [--wait=/url]
npx tsx {script_path}/submit.ts --url=/api/data --method=POST --body='{"key":"val"}' [--wait=/redirect]
```
- No args: Press Enter
- `selector`: Submit a specific form element
- `--url` + `--method` + `--body`: Direct HTTP submit from browser context (with cookies/auth)
- `--wait`: Wait for navigation after submit

### copy.ts — Copy text to clipboard
```bash
npx tsx {script_path}/copy.ts <selector|text>
```
- Copies the text content of the target element or the given string to the clipboard

### find.ts — Find elements
```bash
npx tsx {script_path}/find.ts <selector> [--attr=name] [--text]
```
- `--attr=name`: Return attribute value of the found element
- `--text`: Return text content of the found element

### attr.ts — Get/set element attribute
```bash
npx tsx {script_path}/attr.ts <selector> <attr-name> [value]
```
- Omit `value` to read the attribute; provide `value` to set it

### select.ts — Select dropdown option
```bash
npx tsx {script_path}/select.ts <selector> <value|label>
```
- Selects an option in a `<select>` element by value or visible label

### wait.ts — Conditional wait
```bash
npx tsx {script_path}/wait.ts <ms|selector> [--attr=name --value=expected] [--timeout=ms]
```
- Number: Wait for a duration (ms)
- Selector: Wait until visible
- `--attr` + `--value`: Wait until the selector's attribute reaches a specific value
  - e.g., `wait.ts "#status" --attr=textContent --value=Done`

### fetch.ts — HTTP request with browser auth
```bash
npx tsx {script_path}/fetch.ts <METHOD> <url> [body-json]
```
- Executes HTTP requests from the browser context (inherits cookies/session)
- Methods: GET, POST, PUT, DELETE, PATCH

### evaluate.ts — Execute JavaScript
```bash
npx tsx {script_path}/evaluate.ts <js-expression>
```

### sequence.ts — Flow engine with variables, conditions, loops, and functions
```bash
npx tsx {script_path}/sequence.ts <json-string | json-file-path> [--allow-shell] [--request-permission]
```
Runs an action sequence with full flow control. Stops on failure with an error screenshot.

#### Args format
All actions accept `args` as either an **array** or an **object**:
```json
{"action": "fill", "args": ["#email", "test@test.com"]}
{"action": "fill", "args": {"selector": "#email", "text": "test@test.com"}}
```

#### Basic actions
All browser actions are supported: navigate, click, dblclick, drag, fill, type, hover, scroll, upload, copy, find, attr, select, wait, submit, fetch, screenshot, evaluate

```json
[
  {"action": "navigate", "args": ["http://localhost:3000"]},
  {"action": "fill", "args": ["#email", "test@test.com"]},
  {"action": "click", "args": ["#submit"]},
  {"action": "wait", "args": ["#dashboard"]},
  {"action": "screenshot", "args": ["full"]}
]
```

#### screenshot in sequence
```json
{"action": "screenshot"}
{"action": "screenshot", "args": ["full"]}
{"action": "screenshot", "args": ["#header"]}
{"action": "screenshot", "args": ["100,200,500,300"]}
{"action": "screenshot", "args": ["full", "homepage"]}
{"action": "screenshot", "args": ["#header", "header-shot"]}
```
- No args: Capture viewport
- `"full"`: Full-page capture
- Selector (`#id`, `.class`, `[attr]`): Capture specific element
- `"x,y,width,height"`: Capture coordinate region
- Second arg: Custom filename (e.g., `homepage.png`)

#### Variables — `out` + `{{interpolation}}`
Any step can store its result with `out`. Reference stored variables in args with `{{var.path}}`.
```json
[
  {"action": "fetch", "args": ["GET", "/api/user"], "out": "user"},
  {"action": "log", "ref": "user"},
  {"action": "fill", "args": ["#name", "{{user.data.name}}"]}
]
```
- Nested access: `{{user.data.items.0.name}}`
- Special variables: `{{$index}}`, `{{$key}}`, `{{$error}}`, `{{$errorType}}`
- All stored variables are included in the final `vars` output

#### log — Debug and inspect variables
```json
{"action": "log", "ref": "user.data"}
{"action": "log", "text": "Status is {{user.status}}"}
{"action": "log"}
```
- `ref`: Output a variable value (for inspecting structure)
- `text`: Output interpolated text
- No args: Dump all variables

#### condition — Conditional branching
```json
{"action": "condition", "ref": "user.status", "eq": 200, "then": [
  {"action": "log", "text": "OK"}
], "else": [
  {"action": "log", "text": "Failed"}
]}
```
Operators: `eq`, `neq`, `gt`, `lt`, `contains`, `exists`
- `exists: true` → ref is not null/undefined; `exists: false` → ref is null/undefined
- Comparison values support interpolation: `"eq": "{{expectedValue}}"`

Composite conditions with `and`/`or`:
```json
{"action": "condition", "and": [
  {"ref": "$url", "contains": "/login"},
  {"or": [
    {"ref": "$title", "contains": "Sign in"},
    {"ref": "$title", "contains": "Login"}
  ]}
], "then": [{"action": "log", "text": "auth page"}]}
```

#### each — Iterate arrays and objects
```json
[
  {"action": "fetch", "args": ["GET", "/api/items"], "out": "res"},
  {"action": "each", "ref": "res.data", "as": "item", "items": [
    {"action": "fill", "args": ["#search", "{{item.name}}"]},
    {"action": "click", "args": ["#submit"]}
  ]}
]
```
- **Array**: `"as": "item"` — each element is stored in `item`
- **Object**: `"as": "{k,v}"` — destructure key/value into separate variables
  ```json
  {"action": "each", "ref": "formData", "as": "{field,value}", "items": [
    {"action": "fill", "args": ["#{{field}}", "{{value}}"]}
  ]}
  ```
- Built-in variables: `{{$index}}`, `{{$key}}` (null for arrays)

#### loop — Condition-based loop
```json
{"action": "loop", "condition": {"ref": "$index", "lt": 5}, "items": [
  {"action": "scroll", "args": ["down"]},
  {"action": "wait", "args": ["500"]}
]}
```
- `condition`: A condition node evaluated before each iteration
- `count` is also supported (backward compat) — converted to `condition: {ref: "$index", lt: count}`
- `{{$index}}`: Current iteration (0-based)

#### label + goto — Jump and retry
```json
[
  {"label": "retry"},
  {"action": "fetch", "args": ["GET", "/api/status"], "out": "res"},
  {"action": "condition", "ref": "res.status", "neq": 200, "then": [
    {"action": "wait", "args": ["2000"]},
    {"action": "goto", "label": "retry"}
  ]},
  {"label": "done"},
  {"action": "log", "text": "Ready: {{res.data}}"}
]
```
- `label`: A named marker (no action, just a jump target)
- `goto`: Jump to a label. Bubbles up from nested scopes (condition/each/loop)
- Max 100 jumps to prevent infinite loops

#### def + call — Reusable functions and conditions
```json
[
  {"action": "def", "name": "login", "type": "func", "params": ["email", "pw"], "items": [
    {"action": "fill", "args": ["#email", "{{email}}"]},
    {"action": "fill", "args": ["#password", "{{pw}}"]},
    {"action": "click", "args": ["#submit"]},
    {"action": "wait", "args": ["#dashboard"]}
  ]},
  {"action": "call", "name": "login", "args": ["admin@test.com", "secret"]},
  {"action": "call", "name": "login", "args": {"email": "user@test.com", "pw": "12345"}}
]
```
- `def`: Register a named block. `type`: `"func"` (default) or `"condition"`
- `items`: Step array for func, ConditionNode array for condition
- `call`: Invoke by name (array args mapped to `params` in order, object args by key)
- Supports `out` to capture the last step's result

Condition definition (used in `catch:<name>`):
```json
{"action": "def", "name": "authFail", "type": "condition", "items": [
  {"ref": "$url", "contains": "/login"},
  {"ref": "$title", "contains": "Sign in"}
]}
```

#### try / catch / finally — Error handling
```json
{
  "action": "try",
  "items": [
    {"action": "click", "args": ["Sign in"]}
  ],
  "catch:challenge": [
    {"action": "wait", "args": ["user-action"], "prompt": "Solve challenge"}
  ],
  "catch": [
    {"action": "log", "text": "Error: {{$error}}"}
  ],
  "finally": [
    {"action": "screenshot"}
  ]
}
```
- `items`: Required body
- `catch:<name>`: Typed handler (matches error type or named condition def)
- `catch`: Fallback handler
- `finally`: Always runs
- `{{$error}}`: Error message, `{{$errorType}}`: Classified type

#### shell — Execute local commands
```json
{"action": "shell", "args": ["node", "scripts/seed.js"], "out": "result"}
```
- Requires `--allow-shell` flag
- With `--request-permission`: Prompts user approval (requires `--headed`)
- Result: `{exitCode, stdout, stderr}`
- Object args: `{"command": ["npm", "run", "build"], "timeout": 60000}`

#### wait user-action — Pause with action buttons
```json
{"action": "wait", "args": ["user-action"], "prompt": "Choose action", "actions": ["approve", "skip", "cancel"], "out": "choice"}
```
- `actions`: Button labels (default: `["continue"]`)
- `out`: Stores the clicked button value

## Debugging Tools

### console.ts — Collect console logs
```bash
npx tsx {script_path}/console.ts [inject|dump|clear|tail] [filters...] [--raw]
```
- `inject`: Inject console patching into the browser (once; auto-injected on dump)
- `dump`: Append collected logs to `.playwright-state/console.log` and clear browser logs
- `clear`: Clear both browser and file logs
- `tail`: Return the last 20 lines from the file
- Captures: console.log/warn/error/info/debug + page errors + unhandled rejections

**Filters** (apply to `dump` and `tail`):
- `+keyword`: Include only lines containing keyword
- `-keyword`: Exclude lines containing keyword
- `+/regex/`: Include only lines matching regex
- `-/regex/`: Exclude lines matching regex
- Multiple filters can be combined: `+error -verbose +/api\/.*/`

**`--raw`**: Disable log entry truncation (default: entries are truncated at 2000 chars)

### network.ts — Collect network requests
```bash
npx tsx {script_path}/network.ts [inject|dump|clear|tail|find <pattern>] [--raw]
```
- `inject`: Inject fetch/XHR patching (auto-injected on dump)
- `dump`: Append collected requests to `.playwright-state/network.log`
- `clear`: Clear the log
- `tail`: Return the last 20 entries
- `find <pattern>`: Filter by URL pattern (e.g., `find /api/projects`)
- Captures: method, url, status, request body, response body

**Sensitive data masking** (default on, disabled by `--raw`):
- Headers: `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token` → `[MASKED]`
- Body fields: `password`, `token`, `secret`, `api_key`, `apiKey`, `access_token`, `refresh_token` → `[MASKED]`
- Request/response bodies are truncated at 5000 chars

**`--raw`**: Disable masking and truncation. Warning: sensitive data will be written to disk.

### trace.ts — Record and view traces
```bash
npx tsx {script_path}/trace.ts [start|stop|view|status]
```
- `start`: Start recording a trace
  - `--screenshots`: Include screenshots per action
  - `--snapshots`: Include DOM snapshots per action
- `stop`: Stop recording and save to `.playwright-state/traces/`
  - `--name=trace-name`: Custom trace filename (default: `trace-<timestamp>`)
- `view [name]`: Open the trace viewer (latest trace, or specific name)
- `status`: Check if recording is active + list saved traces

### video.ts — Manage recorded videos
```bash
npx tsx {script_path}/video.ts [list|path|rename|clear]
```
- `list`: List saved videos with sizes and timestamps
- `path`: Get the current recording file path (if active)
- `rename <latest|filename> <new-name>`: Rename a video file
- `clear`: Delete all saved videos

Videos are recorded when using `--video[=name]` flag on launch or any script. Videos are saved in `.playwright-state/videos/`. When a session name is provided via `--video=name`, the video is auto-renamed on `pw close`.

### status.ts — Query session state
```bash
npx tsx {script_path}/status.ts [current|pages|all]
```
- `current`: Current project browser state (port, page list)
- `pages`: List of open tabs/pages (title, url)
- `all`: All browser sessions running across the workspace

### tab.ts — Tab management
```bash
npx tsx {script_path}/tab.ts [new [url] | list | close <index>]
```
- `new [url]`: Open a new tab, returns index
- `list`: List open tabs (index, title, url)
- `close <index>`: Close a tab

## Return Format

All scripts return JSON to stdout:
```json
{
  "success": true,
  "screenshot": ".playwright-state/screenshots/1711234567.png",
  "data": "..."
}
```

Sequence returns additional `vars` with all stored variables:
```json
{
  "success": true,
  "screenshot": ".playwright-state/screenshots/sequence-done.png",
  "data": {
    "completed": 5,
    "total": 5,
    "results": [...],
    "vars": {"user": {"status": 200, "data": {...}}}
  }
}
```

## Custom Scripts

For complex interactions not possible with existing scripts, write a temporary script:

```typescript
// Example temporary script
import { run, screenshotPath } from '~/.claude/skills/pw-browse/scripts/common.js';

run(async ({ page }) => {
  // Complex interaction logic
  await page.goto('http://localhost:3000');
  await page.locator('#dropdown').click();
  await page.locator('[data-value="option1"]').click();

  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path };
});
```

Write temporary scripts in the project's `scripts/playwright/` directory.
Clean up unnecessary temporary scripts when running `pw-close`.

## Chaining

- Browser not running → run `pw-launch` first
- After interaction → keep browser open (until explicitly closed)
