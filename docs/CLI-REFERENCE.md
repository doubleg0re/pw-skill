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
| `pw click <target> --mode=selector\|text` | Skip target detection and force one interpretation |
| `pw click <target> --timeout=<ms>` | Budget for resolving the target (default 5000) |
| `pw dblclick <selector\|text\|x,y>` | Double-click element (same target rules as `click`) |
| `pw hover <selector\|text>` | Hover (tooltips, menus) |
| `pw drag <source> <target>` | Drag and drop; each side is a CSS selector or a viewport `x,y` (mix freely, e.g. element→`x,y`) |
| `pw drag <source> <target> --grab=<anchor\|x,y>` | Grip point on the **source** element (default `center`; ignored if source is a coordinate) |
| `pw drag <source> <target> --drop=<anchor\|x,y>` | Drop point on the **target** element (default `center`; ignored if target is a coordinate) |
| `pw drag <source> <target> --steps=<n>` | Intermediate mouse moves for the pointer path (default 10) |
| `pw drag <source> <target> --mouse` | Force the pointer path even for element→element (for pointer-based DnD libs); native HTML5 drag-and-drop is best served by the default `dragTo` path |
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

### How a click target is resolved

`click`, `dblclick`, `download`, and `paste` all take a target that may be a CSS selector or the element's visible text. Sigil-led (`#id`, `.class`, `[attr=…]`), tag-qualified (`button[aria-label=…]`, `div#main`, `a.link`, `li:nth-child(2)`), and Playwright engine forms (`text=`, `//`, `>>`) are treated as selectors; anything else is treated as text.

The guess only sets which is tried **first** — the other is tried right after, so link text that happens to look like CSS still works. If neither matches, the command fails within `--timeout` (5s total by default) and names both attempts, rather than spending Playwright's 30s auto-wait on a single guess. Use `--mode=selector|text` to skip resolution entirely; the action then waits the full Playwright timeout, which is what you want for an element that appears late.

### Drag grips and coordinates

`drag <source> <target>` accepts a CSS selector **or** a viewport coordinate `x,y` on each side independently, so element→element, element→coordinate, coordinate→element, and coordinate→coordinate all work. Coordinate detection is lenient: `100,200`, `100, 200`, `-5,10`, and `12.5,4` all parse.

`--grab` / `--drop` set which point of the **source** / **target** element is grabbed and dropped (default `center`; ignored when that side is a coordinate). Values are a named anchor — `center`, `top-left`, `top`, `top-right`, `left`, `right`, `bottom-left`, `bottom`, `bottom-right` — or an explicit `x,y` pixel offset from the element's top-left. Named edge/corner anchors land a few px inside the element: the exact corner sits on the border (outside a rounded shape entirely), where hit-testing resolves to a parent and the drag misses. Pass an explicit `x,y` when you need a literal corner.

Pure element→element drags use Playwright's native `dragTo` (the right choice for HTML5 drag-and-drop). Any coordinate side, or `--mouse`, switches to a `mouse.move → down → move(steps) → up` pointer path, where `--steps=<n>` controls the intermediate moves (default 10) — needed by pointer-based DnD libraries.

## Observation

| Command | Description |
|---|---|
| `pw shot\|screenshot` | Capture viewport |
| `pw shot\|screenshot --full` | Capture full page (`--full-page` and `--fullPage` are accepted spellings) |
| `pw shot\|screenshot <selector>` | Capture element |
| `pw shot\|screenshot <x,y,w,h>` | Capture coordinate region |
| `pw shot\|screenshot --out=<path>` | Write to an explicit file path (parent dirs created) |
| `pw shot\|screenshot <path>` | A positional that looks like a file path (`/…`, `./…`, `*.png`) is treated as `--out`, not a selector |
| `pw shot\|screenshot --name=login` | Custom filename within the screenshot dir |
| `pw pdf [--out=<path>]` | Save the page as PDF — print media and backgrounds on by default |
| `pw pdf --format=A4\|Letter\|… [--landscape]` | Page size (default `A4`) and orientation |
| `pw pdf --prefer-css-page-size` | Let the page's `@page` rule decide the size (ignores `--format`) |
| `pw pdf --margin=1cm\|1cm,2cm\|…` | Margins in CSS shorthand order |
| `pw pdf --pages=1-3 [--scale=0.1-2]` | Page range and scale |
| `pw pdf --no-background \| --screen-media` | Opt out of printed backgrounds / print-media emulation |
| `pw copy <selector> [--format=text\|html\|outer\|image]` | Copy text/HTML/image from element. `--format=image` copies element to clipboard as PNG + saves file. `--save-only` to skip clipboard. |
| `pw find <selector> [--detail=tag\|class\|full]` | Query DOM elements |
| `pw attr <selector> <name> [--set=value]` | Read/write DOM attribute |
| `pw eval\|evaluate <js-expression>` | Execute JavaScript in page |
| `pw wait <ms\|HH:MM\|/url\|selector>` | Wait for condition |
| `pw wait <selector> --attr=textContent --value=Done` | Wait for attribute value |

Screenshots default to `./.playwright-state/screenshots` under the current working directory. For session-based work, `pw launch --screenshot-path=dir` pins the screenshot directory in session metadata so later commands keep writing there even if `cwd` changes. `pw pdf` writes to the same directory when `--out` is omitted.

A misspelled flag is rejected rather than ignored: `screenshot --fullpage` used to return a viewport capture as a success, which reads exactly like a verified full-page one.

`pw pdf` needs a **headless chromium** session — `page.pdf()` is unavailable in a headed browser and outside Chromium. It fails with that message instead of falling back to something that looks right but is not.

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
| `pw launch --browser=<name> --name=N [--restart]` | Launch a **registered** real browser in a dedicated profile |
| `pw launch --executable=<path> \| --channel=<c>` | Point at a specific Chromium binary / Playwright channel |
| `pw launch --stealth` | Hide the automation fingerprint (`navigator.webdriver`) — opt-in, see below |
| `pw browser register <name> <path> [--name=D] [--label=L] [--global]` | Register a browser binary for `--browser=<name>` |
| `pw browser list \| search [query] \| remove <name>` | List / search / remove registered browsers |
| `pw use <name>` | Bind session to project (freely switches, returns previous binding if any) |
| `pw sessions` | List all sessions |
| `pw browsers` | Alias for `pw browser list` |
| `pw close [--session=N] [--all]` | Close session(s) |
| `pw tab new [url]` | Open new tab — returns the `tabId` to address it with |
| `pw tab list` | List open tabs with their `index` and stable `tabId` |
| `pw tab close <index>` | Close tab |
| `pw status` | Session status (pages, URL, title) |

A tab **index** is a position in a list that reorders on its own: opening a tab puts it at the front on the next connection, shifting everything after it. Use `--tab-id=<id>` from `pw tab list` for anything that outlives a single command — it tracks the browser's own tab handle, so it survives both reordering and navigation. Both flags fail loudly when they cannot be resolved; an unresolvable `--tab=N` used to silently act on tab 0.

> **Caution for AI agents:** Unless the user explicitly asks to close every session, avoid using `--all`. Other agents or background tasks may have active sessions you do not know about. Prefer plain `pw close` to safely terminate the current bound session.

### Real browsers (via the registry)

By default `pw` launches its bundled Chromium. To drive a **real** installed browser (Brave/Chrome/Edge/…), register its binary once, then launch by name:

```bash
pw browser search brave                                # find the binary under /Applications
pw browser register brave "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --name=work
pw --headed launch --browser=brave                     # opens session "work" (the registered default)
# log in by hand once; from then on `pw --session=work ...` stays logged in
```

The browser runs in a **dedicated pw-managed profile** (`~/.playwright-state/sessions/<name>/`), separate from your everyday profile — pw never touches your working browser. The profile persists across `pw close` / relaunch.

- `--browser=<name>` resolves against the registry (`pw browser register`). `--executable=<path>` or `--channel=<c>` bypass the registry for a one-off binary / Playwright channel.
- Registrations are **local** (`.playwright-state/browsers.json`, per project) by default and override a shared **`--global`** registry (`~/.playwright-state/browsers.json`).
- `register --name=<session>` sets a **default session name**, so `pw launch --browser=<name>` works without `--name`. Otherwise a real-browser launch requires `--name` (the dedicated profile must be reusable).
- `--restart` kills an already-running pw session and relaunches it fresh; without it a live session reconnects (and passing `--browser` to a running session warns to use `--restart`).

**`--stealth`** hides the automation fingerprint (`navigator.webdriver`, which pw's CDP control otherwise exposes). Some sign-in flows (e.g. Google) block browsers that report it, even for a login you type by hand. It flips only that JS-visible flag — pw's control channel is unaffected — and persists on the session. **It is off by default and opt-in**: hiding the flag defeats the bot-detection sites rely on and can violate their terms, so enable it only where you must sign in.

> Note: a browser's *existing* profiles can't be driven directly — Chromium 136+ blocks remote debugging on the default profile, and all profiles share one running instance — so pw always uses a dedicated profile. To reuse a login, sign into the dedicated profile once.

### Listing & cleaning profiles

Each `--name` is a separate dedicated profile at `~/.playwright-state/sessions/<name>/`. **`pw profiles`** lists them all — **active**, **dead** (registered but the process died), and **dormant** (closed with `pw close`; invisible to `pw sessions`) — with the browser + stealth each was created with and when it was last used. Add `--size` for on-disk usage.

A dedicated profile remembers its browser: after `pw close`, `pw launch --name=<x>` (no `--browser`) re-opens it as the same browser (and stealth). This is backed by a durable `profile.json` that survives close.

**`pw doctor`** (alias of `pw analyze`) reports dormant profiles among the other health items. Reclaim disk with **`pw clean profiles`** — by default it removes only the auto-generated throwaway `s-<hex>` profiles, never your named ones or the bound one. `pw clean profiles --all` also removes dormant **named** profiles, which deletes their logins — use deliberately.

## Safe mode (delegating pw to agents)

`pw` is built for a trusted operator. Handing it to an **agent** exposes escape hatches — `eval`, `nav file://`, `rary` (clones + runs code), `pw run`, `seq` shell — that together amount to a shell + filesystem reader. **Safe mode** keeps the browser verbs and drops those.

Turn it on with **`PW_SAFE=1`** (env) or **`--safe`** (flag). It is resolved once at startup and **not overridable mid-session** — an agent driving pw cannot lift it. Set `PW_SAFE=1` in the agent's environment; the flag is for manual use.

```bash
PW_SAFE=1 pw nav https://localhost:5180   # ok
PW_SAFE=1 pw nav file:///app/src/x.ts     # blocked (http/https only)
PW_SAFE=1 pw eval "document.title"        # blocked, fails loud
pw --version                              # prints a "mode: safe (env)" line under PW_SAFE
```

In safe mode:
- **Navigation**: `http`/`https`/`about` only — no `file://`, `chrome://`, `data:`.
- **Disabled (fail loud)**: `eval`, `pw run`, `rary get/yoink/put/rolling`, and `seq` shell (even with `--allow-shell`).
- **Path-confined to `.playwright-state/`**: `dump --save`, `upload`, `paste --image` reject paths outside it.
- Read/drive verbs (`click`, `type`, `dump`, `shot`, `read`, `react`, …) work normally — driving the app is the point.

> Enforcement is the operator's environment — the same trust model as spawning a subagent with a fixed toolset. If you also hand the agent a shell it can unset the env, so pair safe mode with OS-level sandboxing there.

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
--tab=N             Target tab by position (default: 0) — errors when out of range
--tab-id=N          Target tab by stable id from `pw tab list` — survives reordering
--headed            Show browser window
--viewport=auto|WxH Viewport size (default: auto — follows the window; headless uses a 1440x900 default window)
--video[=name]      Enable video recording
--raw               Bypass truncation/masking in console/network dump
```
