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
pw navigate http://localhost:3000 --screenshot
pw click "#login-btn"
pw dblclick "#editable-cell"
pw drag "#item-1" "#drop-zone"
pw fill "#email" "user@test.com"
pw type "password123"
pw screenshot --full
pw evaluate "document.title"
pw console dump
pw network find /api
pw tab new http://localhost:3000/admin
pw tab list
pw status
pw close
```

### Claude Code (automatic)

Claude automatically uses these skills when you say things like:
- "Open the browser and check the login page"
- "Take a screenshot of the dashboard"
- "Run E2E tests on the project list"
- "Check the console for errors"

## Skills

| Skill | Tokens | Trigger |
|---|---|---|
| `pw-launch` | ~540 | "Open browser", or auto when needed |
| `pw-browse` | ~850 | "Screenshot", "Click", "Navigate" |
| `pw-test` | ~470 | "Run tests", "E2E" |
| `pw-close` | ~300 | "Close browser", or auto after tests |

Skills load **only when needed**. Idle cost: **0 tokens**.

## Scripts

| Script | Description |
|---|---|
| `navigate.ts` | URL navigation + optional screenshot |
| `screenshot.ts` | Full page or element capture |
| `click.ts` | Click by selector, text, or coordinates |
| `dblclick.ts` | Double-click by selector, text, or coordinates |
| `drag.ts` | Drag and drop by selector or coordinates |
| `fill.ts` | Click + fill input field |
| `type.ts` | Keyboard typing with optional delay |
| `evaluate.ts` | Execute JavaScript in page |
| `console.ts` | Console log capture (inject/dump/clear/tail) |
| `network.ts` | Network request capture (inject/dump/clear/tail/find) |
| `tab.ts` | Tab management (new/list/close) |
| `status.ts` | Session status (current/pages/all) |

### Global flags

```bash
--tab=N          Target specific tab (default: 0)
--headed         Show browser window
--viewport=WxH   Viewport size (default: 1920x1080)
```

## Architecture

```
pw-skill/
├── .claude-plugin/          # Claude Code plugin metadata
├── skills/
│   ├── pw-launch/SKILL.md   # Browser launch skill
│   ├── pw-browse/           # Browser interaction skill
│   │   ├── SKILL.md
│   │   └── scripts/         # 10+ utility scripts
│   ├── pw-test/SKILL.md     # E2E test skill
│   └── pw-close/SKILL.md    # Browser close skill
└── package.json             # npm package with `pw` CLI
```

### Key design decisions

- **CDP persistent browser**: Chromium stays alive across script invocations. DOM, JS state, scroll position, form data — all preserved.
- **4 modular skills**: Only the relevant skill loads into Claude's context. Zero tokens when idle.
- **Local-first fallback**: Project scripts override global scripts.
- **Console/Network inject**: Patches browser globals to capture logs even between disconnects.

## Comparison

| Feature | pw-skill | lackeyjb | willmarple |
|---|---|---|---|
| Token efficiency | 4 skills, load on demand | 1 skill, always loaded (14KB) | 1 skill, always loaded (10KB) |
| Browser persistence | CDP, full state | None, new browser each time | Playwright CLI sessions |
| Console capture | inject + file log | None | Via playwright-cli |
| Network capture | inject + file log | None | Via playwright-cli |
| Tab management | Full (new/list/close/--tab=N) | None | None |
| CLI | `pw` command | None | bin/ scripts |
| Complexity | Medium (10 scripts) | Low (2 files) | High (11 bin + TS + Zod) |

## License

MIT
