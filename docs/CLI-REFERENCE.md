# CLI Reference

Full reference for every `pw` subcommand. For a short cheatsheet see the [README CLI section](../README.md#cli-reference), or run `pw help` in the terminal.

## Navigation

| Command | Description |
|---|---|
| `pw nav\|navigate <url> [--screenshot]` | Go to URL |
| `pw refresh\|reload [--screenshot]` | Reload current page |
| `pw resize <width>x<height>` | Resize the current browser window when possible, otherwise fall back to viewport resize |

## Interaction

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

## Observation

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

## HTTP

| Command | Description |
|---|---|
| `pw fetch GET /api/projects` | HTTP GET with browser auth |
| `pw fetch POST /api/projects '{"name":"test"}'` | HTTP POST with browser auth |
| `pw fetch PUT\|DELETE\|PATCH ...` | All standard methods supported |

## Automation

| Command | Description |
|---|---|
| `pw sequence <json-string\|file>` | Run action sequence (see [SEQUENCE-SYNTAX.md](SEQUENCE-SYNTAX.md)) |
| `pw run <script.ts\|script.js> [args...]` | Run a custom project script, searching `scripts/playwright/` first for bare names |

## Session & Tabs

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

## Debugging

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

## Global Flags

All commands support these flags:

```
--session=N         Target specific session
--tab=N             Target specific tab (default: 0)
--headed            Show browser window
--viewport=auto|WxH Viewport size (default: auto)
--video[=name]      Enable video recording
--raw               Bypass truncation/masking in console/network dump
```
