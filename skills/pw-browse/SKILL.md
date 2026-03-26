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

## General-purpose Script Reference

### navigate.ts — Navigate to URL
```bash
npx tsx {script_path}/navigate.ts <url> [--screenshot] [--headed] [--viewport=WxH]
```

### screenshot.ts — Capture page
```bash
npx tsx {script_path}/screenshot.ts [selector] [--full] [--headed]
```
- `selector`: CSS selector (omit for full page)
- `--full`: Full-page scroll capture

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

### sequence.ts — Run action sequence
```bash
npx tsx {script_path}/sequence.ts <json-string | json-file-path>
```
Runs multiple actions sequentially from a JSON array. Stops on failure with an error screenshot.
```json
[
  {"action": "navigate", "args": ["http://localhost:3000"]},
  {"action": "fill", "args": ["#email", "test@test.com"]},
  {"action": "click", "args": ["#submit"]},
  {"action": "wait", "args": ["#dashboard"]},
  {"action": "wait", "args": ["#status", "textContent", "Done"]},
  {"action": "screenshot", "args": ["full"]}
]
```
Supported actions: navigate, click, dblclick, drag, fill, type, hover, scroll, upload, copy, find, attr, select, wait, screenshot, evaluate

### evaluate.ts — Execute JavaScript
```bash
npx tsx {script_path}/evaluate.ts <js-expression>
```

### console.ts — Collect console logs
```bash
npx tsx {script_path}/console.ts [inject|dump|clear|tail]
```
- `inject`: Inject console patching into the browser (once; auto-injected on dump)
- `dump`: Append collected logs to `.playwright-state/console.log` and clear browser logs
- `clear`: Clear both browser and file logs
- `tail`: Return the last 20 lines from the file
- Captures: console.log/warn/error/info/debug + page errors + unhandled rejections

### network.ts — Collect network requests
```bash
npx tsx {script_path}/network.ts [inject|dump|clear|tail|find <pattern>]
```
- `inject`: Inject fetch/XHR patching (auto-injected on dump)
- `dump`: Append collected requests to `.playwright-state/network.log`
- `clear`: Clear the log
- `tail`: Return the last 20 entries
- `find <pattern>`: Filter by URL pattern (e.g., `find /api/projects`)
- Captures: method, url, status, request body, response body

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

### All scripts support `--tab=N`
```bash
npx tsx {script_path}/click.ts "#btn" --tab=1
npx tsx {script_path}/screenshot.ts --full --tab=2
```
Target a specific tab. Defaults to the first tab (0) if omitted.

## Return Format

All scripts return JSON to stdout:
```json
{
  "success": true,
  "screenshot": ".playwright-state/screenshots/1711234567.png",
  "data": "..."
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
