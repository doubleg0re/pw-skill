# pw-skill

Playwright CLI Skill for Claude Code. Replaces Playwright MCP with a modular, token-efficient, persistent browser approach.

## Why not MCP?

| | MCP | pw-skill |
|---|---|---|
| Token cost | ~3,500+ tokens always loaded | ~850 tokens per skill, only when needed |
| Browser session | New browser per action | Persistent via CDP |
| Debug tools | None | Console logs, network capture |
| Tab management | None | Full tab control |
| CLI access | No | `pw` command |

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

## Usage

### CLI

```bash
# Navigation
pw navigate http://localhost:3000 --screenshot

# Interaction
pw click "#login-btn"
pw dblclick "#editable-cell"
pw hover "#tooltip-trigger"
pw drag "#item-1" "#drop-zone"
pw scroll bottom
pw fill "#email" "user@test.com"
pw type "password123"
pw select "#country" --value=kr
pw upload "#file-input" ./report.pdf
pw submit "#login-form" --wait=/dashboard
pw submit --url=/api/projects --method=POST --body='{"name":"test"}' --wait=/projects

# Observation
pw screenshot --full
pw copy "#article" --format=html
pw find ".card" --detail=full
pw attr "#input" value
pw attr "#div" data-id --set=123
pw evaluate "document.title"
pw wait 3000
pw wait 14:30
pw wait /dashboard
pw wait "#modal"
pw wait "#status" --attr=textContent --value=Done

# HTTP
pw fetch GET /api/projects
pw fetch POST /api/projects '{"name":"test"}'
pw fetch PUT /api/projects/1 '{"name":"updated"}'
pw fetch DELETE /api/projects/1

# Debug
pw console inject
pw console dump
pw console tail
pw network inject
pw network dump
pw network find /api

# Automation
pw sequence ./login-flow.json

# Session
pw tab new http://localhost:3000/admin
pw tab list
pw tab close 2
pw status
pw close
```

### Claude Code (automatic)

Claude automatically uses these skills when you say things like:
- "Open the browser and check the login page"
- "Take a screenshot of the dashboard"
- "Run E2E tests on the project list"
- "Check the console for errors"
- "What does the /api/projects endpoint return?"

## Skills

| Skill | Tokens | Trigger |
|---|---|---|
| `pw-launch` | ~540 | "Open browser", or auto when needed |
| `pw-browse` | ~850 | "Screenshot", "Click", "Navigate" |
| `pw-test` | ~470 | "Run tests", "E2E" |
| `pw-close` | ~300 | "Close browser", or auto after tests |

Skills load **only when needed**. Idle cost: **0 tokens**.

## Scripts (24)

### Navigation
| Script | Description |
|---|---|
| `navigate.ts` | Go to URL + optional screenshot |

### Interaction
| Script | Description |
|---|---|
| `click.ts` | Click by selector, text, or coordinates |
| `dblclick.ts` | Double-click by selector, text, or coordinates |
| `hover.ts` | Hover over element (tooltips, dropdown menus) |
| `drag.ts` | Drag and drop by selector or coordinates |
| `scroll.ts` | Scroll page (up/down/top/bottom/to element/by px) |
| `fill.ts` | Click + fill input field |
| `type.ts` | Type on keyboard with optional delay |
| `select.ts` | Select dropdown option (by value/label/index) |
| `upload.ts` | Upload file(s) to input |
| `submit.ts` | Submit form (Enter, selector, or direct HTTP POST) |

### Observation
| Script | Description |
|---|---|
| `screenshot.ts` | Capture full page or element |
| `copy.ts` | Copy text/HTML/outerHTML from element |
| `find.ts` | Query DOM elements (tag/class/full detail, children, attr filter) |
| `attr.ts` | Read/write DOM attribute (textContent, value, data-*, ...) |
| `evaluate.ts` | Execute JavaScript in page |
| `wait.ts` | Wait for ms, clock time (HH:MM), URL pattern, selector, or attribute value |

### HTTP
| Script | Description |
|---|---|
| `fetch.ts` | HTTP request with browser cookies/auth (GET/POST/PUT/DELETE/PATCH) |

### Debug
| Script | Description |
|---|---|
| `console.ts` | Console log capture via browser inject (inject/dump/clear/tail) |
| `network.ts` | Network request capture via fetch/XHR inject (inject/dump/clear/tail/find) |

### Automation
| Script | Description |
|---|---|
| `sequence.ts` | Run action sequence from JSON file or string (supports all commands) |

### Session
| Script | Description |
|---|---|
| `tab.ts` | Tab management (new/list/close) |
| `status.ts` | Session status (current/pages/all) |

### Global flags

All scripts support these flags:

```bash
--tab=N          Target specific tab (default: 0)
--headed         Show browser window
--viewport=WxH   Viewport size (default: 1920x1080)
```

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

## Architecture

```
pw-skill/
├── .claude-plugin/          # Claude Code plugin metadata
├── skills/
│   ├── pw-launch/SKILL.md   # Browser launch skill
│   ├── pw-browse/           # Browser interaction skill
│   │   ├── SKILL.md
│   │   └── scripts/         # 24 utility scripts + common.ts + pw.ts
│   ├── pw-test/SKILL.md     # E2E test skill
│   └── pw-close/SKILL.md    # Browser close skill
└── package.json             # npm package with `pw` CLI
```

### Key design decisions

- **CDP persistent browser**: Chromium stays alive across script invocations. DOM, JS state, scroll position, form data — all preserved.
- **4 modular skills**: Only the relevant skill loads into Claude's context. Zero tokens when idle.
- **Local-first fallback**: Project scripts in `scripts/playwright/` override global scripts.
- **Console/Network inject**: Patches browser globals to capture logs even between CDP disconnects.
- **Browser auth in HTTP**: `fetch` and `submit` use browser cookies, so API calls are authenticated automatically.

## Comparison

| Feature | pw-skill | lackeyjb | willmarple |
|---|---|---|---|
| Token efficiency | 4 skills, load on demand | 1 skill, always loaded (14KB) | 1 skill, always loaded (10KB) |
| Browser persistence | CDP, full state preserved | None, new browser each time | Playwright CLI sessions |
| Scripts | 24 (full browser + HTTP + debug + automation) | 2 (run.js, helpers.js) | 11 bin scripts |
| Console capture | inject + file log | None | Via playwright-cli |
| Network capture | inject + file log | None | Via playwright-cli |
| HTTP requests | `fetch` + `submit` with browser auth | None | None |
| Tab management | Full (new/list/close/--tab=N) | None | None |
| Action sequence | JSON-based, all 24 commands, clock time wait | None | None |
| DOM query | `find` + `attr` + `copy` | None | Via snapshot |
| CLI | `pw` command (24 subcommands) | None | bin/ scripts |

## License

MIT
