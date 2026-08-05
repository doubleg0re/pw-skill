#!/usr/bin/env npx tsx
// pw CLI — Playwright Skill unified command
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { buildChainStepArgs, CHAINABLE_ACTIONS, CHAINABLE_ACTION_SET, parseChainSegments, splitLeadingGlobalFlags, wantsHelp } from './chain-utils.js';
import { buildRunScriptCandidates, resolveRunScriptPath } from './run-command.js';

const SCRIPTS_DIR = resolve(import.meta.dirname || __dirname, '.');
const args = process.argv.slice(2);
const CHAINABLE_ACTIONS_TEXT = CHAINABLE_ACTIONS.join(', ');
const GLOBAL_FLAG_NAMES = new Set(['session', 'headed', 'viewport', 'device', 'video', 'no-restore', 'no-pin-check']);

const AGENT_SKILLS: Record<string, { title: string; summary: string; when: string[]; cli: string[]; notes?: string[] }> = {
  browse: {
    title: 'pw-browse',
    summary: 'Playwright browser control for screenshots, clicks, input, navigation, and page inspection.',
    when: [
      'You need browser interaction right now',
      'You want screenshots, clicks, fills, dumps, or navigation',
      'You want to inspect or validate a UI quickly',
    ],
    cli: [
      'pwi nav|navigate <url> [--screenshot]',
      'pwi nav <url> :: refresh :: shot',
      'pw nav|navigate <url> [--session=N]',
      'pw nav <url> :: refresh :: wait 1000',
      'pw refresh [--session=N]',
      'pw click <target> [--session=N]',
      'pw fill <selector> <text> [--session=N]',
      'pw shot|screenshot [selector] [--full] [--out=path] [--session=N]',
    ],
    notes: [
      '`pwi` is the lightest entry point for one-shot work',
      'Inline `::` chaining works in both `pwi` and `pw` for browser actions only',
      `Chainable actions: ${CHAINABLE_ACTIONS_TEXT}`,
      'Short aliases: nav=navigate, shot=screenshot, sel=select, eval=evaluate',
      "Quote '$ret' in the shell when passing the previous step result into a later step",
      'Custom extension actions and commands like launch, close, rary, and analyze are not chainable',
      'Session-based `pw` commands pair naturally with `pw agent skill --launch`',
    ],
  },
  launch: {
    title: 'pw-launch',
    summary: 'Launch or resume a named Playwright session and bind it to the current project.',
    when: [
      'You need a persistent browser session',
      'You want resumable state, saved profile, or named sessions',
      'A browse or test flow needs a browser but none is running',
    ],
    cli: [
      'pw launch [url] [--name=N] [--resume=N] [--screenshot-path=dir]',
      'pw launch [url] --headed [--video[=name]]',
      'pw use <name>',
      'pw sessions',
    ],
    notes: [
      'Session screenshots default to the launch cwd under .playwright-state/screenshots',
      'Use `--screenshot-path=dir` to pin a session to a stable screenshot directory',
    ],
  },
  test: {
    title: 'pw-test',
    summary: 'Write and run Playwright E2E tests, then report pass/fail results.',
    when: [
      'You need an E2E spec written or updated',
      'You want to run or validate Playwright tests',
      'You want page behavior checked beyond ad hoc browser actions',
    ],
    cli: [
      'npx playwright test tests/e2e/<file>.spec.ts',
      'npx playwright test tests/e2e/<file>.spec.ts --headed',
      'pw agent skill --launch',
      'pw agent skill --close',
    ],
    notes: [
      'Typical flow: confirm scope, write the spec, run it, then close or keep the session',
    ],
  },
  close: {
    title: 'pw-close',
    summary: 'Terminate Playwright sessions and clean up session metadata.',
    when: [
      'You are done with the browser session',
      'You want to close a specific named session',
      'You want to shut down all active sessions',
    ],
    cli: [
      'pw close',
      'pw close --session=N',
      'pw close --all',
    ],
    notes: [
      'Profiles are preserved for `pw launch --resume=N` unless you explicitly delete local state',
    ],
  },
};

function renderAgentSkillIndex(): string {
  return `
pw agent skill — compact CLI summaries for pw-skill agent docs

Usage:
  pw agent skill --all
  pw agent skill --browse
  pw agent skill --launch
  pw agent skill --test
  pw agent skill --close

Available:
  --all      Show all skill summaries
  --browse   Browser control
  --launch   Start or resume sessions
  --test     Playwright E2E testing
  --close    Session shutdown and cleanup
`.trim();
}

function renderAgentSkill(name: string): string {
  const skill = AGENT_SKILLS[name];
  if (!skill) return renderAgentSkillIndex();

  const lines = [
    `${skill.title} — ${skill.summary}`,
    '',
    'Use when:',
    ...skill.when.map(line => `  - ${line}`),
    '',
    'CLI entrypoints:',
    ...skill.cli.map(line => `  - ${line}`),
  ];

  if (skill.notes?.length) {
    lines.push('', 'Notes:', ...skill.notes.map(line => `  - ${line}`));
  }

  return lines.join('\n');
}

function renderAllAgentSkills(): string {
  return [
    renderAgentSkillIndex(),
    ...Object.keys(AGENT_SKILLS).map(name => renderAgentSkill(name)),
  ].join('\n\n');
}

function renderSequenceHelp(): string {
  return `
pw seq|sequence — JSON/action flow runner

Usage:
  pw seq '<json-array>'
  pw sequence '<json-array>'
  pw seq ./scripts/playwright/login-flow.json
  pw seq ./scripts/playwright/login-flow.json --params ./params.json

Step forms:
  explicit                                {"action":"navigate","args":["https://example.com"]}
  shorthand                               {"navigate":"https://example.com"}
  shorthand                               {"fill":["#email","me@example.com"]}
  note                                    Shorthand must be a single-key action object
  note                                    Do not mix shorthand with metadata like out, label, or comment

Args:
  optional in syntax                      Only some steps are meaningful without args
  safe without args                       screenshot, log, comment-only steps, label-only steps
  usually needs args                      navigate, click, fill, evaluate, shell, and most browser actions

Flow steps:
  browser actions                         Use regular browser actions like navigate, refresh, screenshot, click, fill, dump, wait, fetch, and evaluate
  aliases                                 nav=navigate, shot=screenshot, sel=select, eval=evaluate, reload=refresh
  flow control                            log, condition, each, loop, def, call, goto, try, set, return
  restricted                              shell requires --allow-shell and explicit args

Examples:
  pw seq '[{"action":"navigate","args":["https://example.com"]},{"action":"screenshot"}]'
  pw seq '[{"nav":"https://example.com"},{"fill":["#email","me@example.com"]},{"shot":"full"}]'
  pw seq ./scripts/playwright/login-flow.json --session=my-session

Chaining (::):
  pwi nav <url> :: refresh :: shot
  pw nav <url> :: fill <selector> <text> :: refresh
  pw eval 'getToken()' :: fetch GET /api/members --auth='$ret'
  supported                               ${CHAINABLE_ACTIONS_TEXT}
  note                                    Chaining is browser-actions-only and separate from seq JSON/file syntax
  note                                    Quote '$ret' or '$ret.path' in the shell to reference the previous step result
`.trim();
}

function renderMainHelp(): string {
  return `
pw — Playwright CLI Skill

Usage: pw <command> [args...]
       pw help [seq|sequence]
       pw --version

Start here:
  pwi                                     Simplest path; one-shot browser work
  seq|sequence                            Lightweight multi-step automation
  rary                                    Advanced runtime: extensions, hooks, sidecars

For agents:
  agent skill --browse                    Compact CLI summary for pw-browse
  agent skill --launch                    Compact CLI summary for pw-launch
  agent skill --test                      Compact CLI summary for pw-test
  agent skill --close                     Compact CLI summary for pw-close

Chaining:
  pwi a :: b :: c                         One-shot inline chain
  pw a :: b :: c                          Session-based inline chain
  pw eval 'getToken()' :: fetch GET /api/members --auth='$ret'
  supported                               ${CHAINABLE_ACTIONS_TEXT}
  aliases                                 nav=navigate, shot=screenshot, sel=select, eval=evaluate, reload=refresh
  note                                    No custom actions; launch/close/rary/analyze not chainable
  note                                    Quote '$ret' or '$ret.path' in the shell to use the previous step result
  seq syntax                              Run pw help seq

Session management:
  launch [url] [--name=N] [--resume=N] [--pin] [--screenshot-path=dir] Launch browser session (--pin: lock to url origin)
  launch --browser=brave|chrome|edge [--restart]   Drive the real browser binary in a dedicated profile (--restart: kill & relaunch if already running)
  launch --executable=<path> | --channel=<c>       Point at a specific Chromium binary / Playwright channel
  launch --stealth                                 Hide the automation fingerprint (navigator.webdriver); opt-in — defeats site bot-detection, use only where you must sign in
  use <name> [--pin]                        Bind session to project (--pin: lock to current origin)
  sessions                                  List all sessions
  browsers                                  List installed browsers + their profiles (discovery)
  close [--session=N] [--all]               Close session(s)

Diagnostics:
  analyze                                   Diagnose sessions, bindings, artifacts
  clean <dead|stale|orphans|all>             Safe cleanup (broken pkgs → pw rary kick)

Package management (Larry's toybox):
  rary get|yoink <repo|path>                Fetch a toy into the toybox
  rary toybox                               List installed packages
  rary peek <package>                       Inspect a package
  rary put <package>                        Activate an extension
  rary ignore|snub <package>                Deactivate an extension
  rary rolling <package>                    Run first-time setup
  rary destroy|kick <package>               Remove a package
  rary need-repair                          Check for broken packages

Browser actions:
  nav|navigate <url> [--screenshot]          Go to URL
  refresh|reload [--screenshot]              Reload current page
  resize <width>x<height>                    Resize browser window/viewport
  shot|screenshot [selector] [--full] [--out=path] Capture page or element (selector = CSS, not output path)
  click <target> [--mode=selector|text|coord] [--exact] [--within=<sel>] [--dblclick] Click element
  dblclick <target> [--mode=...]             Double-click element
  hover <target> [--mode=...]                Hover over element
  drag <source|x,y> <target|x,y> [--grab=A] [--drop=A] [--steps=n] [--mouse] Drag/drop; each side is a selector or viewport x,y. A=grip anchor (center,top-left,top,top-right,left,right,bottom-left,bottom,bottom-right) or x,y offset. --mouse forces the pointer path (native HTML5 DnD uses the default).
  scroll <up|down|top|bottom|selector>       Scroll page
  fill <selector> <text>                     Fill input field
  type <text> [--delay=ms]                   Type on keyboard
  press <key> [--delay=ms]                   Press a key/combo (Enter, Escape, Tab, ArrowDown, cmd+z)
  sel|select <selector> (--value=x|--label=x|--index=n) Select dropdown option
  upload <selector> <file-path...>           Upload file
  download <target> [--async] [--dir=path]   Download file
  download [status|list]                     Check downloads
  submit [form-selector] [--wait=/url]       Submit form
  copy <selector> [--format=text|html|outer|image] Copy text/HTML/image
  paste [selector] [--text=T] [--image=path]   Paste text or image
  dump [--body] [--selector=S] [--text]       Dump raw DOM/HTML/text
  attr <selector> <name> [--set=value]       Read/write DOM attribute
  find <selector> [--detail=tag|class|full]  Query DOM elements
  wait <ms|HH:MM|url|selector> [--attr --value] Wait for condition
  fetch <METHOD> <url> [body-json] [--auth=T] [--credentials=include|same-origin|omit] HTTP request with auth
  assert <selector> [--exists|--visible|--hidden|--count=N|--text=T|--contains=T|--attr=A --value=V] [--wait=ms] Assert element state
  eval|evaluate <js-expression>              Run JavaScript in page
  react <selector> [--limit=n]               Inspect React fiber tree (component chain, handlers, source)
  react --pick | --pick-result [--clear]     Interactive component picker (inject overlay / read captures)
  run <script.ts|script.js> [args...]        Run a custom project script
  seq|sequence <json|file>                  Run action sequence (syntax: pw help seq)
  screenshots                               Default: current cwd/.playwright-state/screenshots
  sessions                                  pw launch --screenshot-path=dir pins screenshot output for that session

Debugging:
  console [inject|dump|clear|tail]           Console log capture
  network [inject|dump|clear|tail|find]      Network capture (find: --body --json --body-limit=N)
  trace [start|stop|view|status]             Record and view traces
  video [list|path|rename|clear]             Manage recorded videos
  tab [new|list|close] [args...]             Manage browser tabs

Global flags:
  --session=N    Target specific session (name or ID)
  --no-pin-check Bypass a session's origin pin for this command
  --tab=N        Target specific tab (default: 0)
  --headed       Show browser window
  --viewport=auto|WxH Viewport size (default: auto)
  --device=name  Playwright device preset, applied at launch (example: "iPhone 12"; --device=none disables; relaunch to change)
  --video[=name] Enable video recording
`.trim();
}

/**
 * Usage for a single command, for `pw <command> --help`. Reuses the signature +
 * description line from the main help (single source of truth); falls back to the
 * full help when no per-command line exists.
 */
function renderCommandUsage(command: string): string {
  const line = renderMainHelp().split('\n').find(raw => {
    const trimmed = raw.trim();
    const firstToken = trimmed.split(/\s+/)[0];
    return firstToken.split('|').includes(command);
  });
  return line ? `pw ${line.trim()}` : renderMainHelp();
}

function resolveTsxCli(): string {
  const candidates = [
    resolve(SCRIPTS_DIR, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    resolve(SCRIPTS_DIR, '..', '..', '..', '..', 'tsx', 'dist', 'cli.mjs'),
  ];
  const cli = candidates.find(existsSync);
  if (!cli) {
    throw new Error('tsx runtime not found');
  }
  return cli;
}

function spawnScript(scriptPath: string, scriptArgs: string[]) {
  const cmdArgs = scriptPath.endsWith('.ts')
    ? [resolveTsxCli(), scriptPath, ...scriptArgs]
    : [scriptPath, ...scriptArgs];

  return spawnSync(process.execPath, cmdArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
}

// --version: print the package version
if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
  try {
    const { version } = JSON.parse(readFileSync(resolve(SCRIPTS_DIR, '../../../package.json'), 'utf8'));
    console.log(version);
  } catch {
    console.log('unknown');
  }
  process.exit(0);
}

// --inline mode: delegate to pwi
if (args[0] === '--inline' || args[0] === '-i') {
  const pwiScript = join(SCRIPTS_DIR, 'pwi.ts');
  const result = spawnScript(pwiScript, args.slice(1));
  process.exit(result.status ?? 1);
}

// :: chaining: build sequence JSON and run through full runtime (session-based)
if (args.includes('::')) {
  const { segments, globalFlags } = parseChainSegments(args, GLOBAL_FLAG_NAMES);

  const rejected = segments.filter(s => !CHAINABLE_ACTION_SET.has(s.action)).map(s => s.action);
  if (rejected.length > 0) {
    console.log(JSON.stringify({
      success: false,
      error: `pw chaining only supports built-in chainable actions. Not chainable: ${rejected.map(r => `"${r}"`).join(', ')}. Supported: ${CHAINABLE_ACTIONS_TEXT}. Custom extension actions and commands like launch, close, rary, and analyze must use separate pw commands or \`pw sequence\`.`,
    }));
    process.exit(1);
  }

  // Build inline sequence JSON and run through sequence.ts (full runtime)
  const seqSteps = JSON.stringify(segments.map(s => ({ action: s.action, args: buildChainStepArgs(s.args) })));
  const seqScript = join(SCRIPTS_DIR, 'sequence.ts');
  const result = spawnScript(seqScript, [seqSteps, ...globalFlags]);
  process.exit(result.status ?? 1);
}

// Peel leading global flags (`pw --session=x nav url`) so the command token is
// found regardless of flag position; re-append them so sub-scripts still see them.
const { leadingFlags: leadingGlobalFlags, rest: commandArgs } = splitLeadingGlobalFlags(args, GLOBAL_FLAG_NAMES);
const rawCommand = commandArgs[0];
const command = rawCommand === 'seq' ? 'sequence' : rawCommand;
const restArgs = [...commandArgs.slice(1), ...leadingGlobalFlags];

// Parse --flag=value from restArgs
function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = restArgs.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return restArgs.includes(`--${name}`);
}

const COMMANDS: Record<string, { script: string; desc: string }> = {
  navigate:    { script: 'navigate.ts',    desc: 'Go to URL' },
  nav:         { script: 'navigate.ts',    desc: 'Go to URL' },
  refresh:     { script: 'refresh.ts',     desc: 'Reload current page' },
  reload:      { script: 'refresh.ts',     desc: 'Reload current page' },
  resize:      { script: 'resize.ts',      desc: 'Resize browser window/viewport' },
  screenshot:  { script: 'screenshot.ts',  desc: 'Capture page' },
  shot:        { script: 'screenshot.ts',  desc: 'Capture page' },
  click:       { script: 'click.ts',       desc: 'Click element' },
  dblclick:    { script: 'dblclick.ts',    desc: 'Double-click element' },
  hover:       { script: 'hover.ts',       desc: 'Hover over element' },
  drag:        { script: 'drag.ts',        desc: 'Drag and drop' },
  scroll:      { script: 'scroll.ts',      desc: 'Scroll page' },
  fill:        { script: 'fill.ts',        desc: 'Fill input field' },
  type:        { script: 'type.ts',        desc: 'Type on keyboard' },
  press:       { script: 'press.ts',       desc: 'Press a key or combo' },
  select:      { script: 'select.ts',      desc: 'Select dropdown option' },
  sel:         { script: 'select.ts',      desc: 'Select dropdown option' },
  upload:      { script: 'upload.ts',      desc: 'Upload file' },
  download:    { script: 'download.ts',    desc: 'Download file' },
  submit:      { script: 'submit.ts',      desc: 'Submit form' },
  copy:        { script: 'copy.ts',        desc: 'Copy text/HTML/image' },
  paste:       { script: 'paste.ts',       desc: 'Paste text/image' },
  dump:        { script: 'dump.ts',        desc: 'Dump raw DOM/HTML/text' },
  attr:        { script: 'attr.ts',        desc: 'Read/write DOM attribute' },
  find:        { script: 'find.ts',        desc: 'Query DOM elements' },
  wait:        { script: 'wait.ts',        desc: 'Wait for condition' },
  fetch:       { script: 'fetch.ts',       desc: 'HTTP request (with auth)' },
  evaluate:    { script: 'evaluate.ts',    desc: 'Run JavaScript' },
  eval:        { script: 'evaluate.ts',    desc: 'Run JavaScript' },
  assert:      { script: 'assert.ts',      desc: 'Assert element state' },
  react:       { script: 'react.ts',       desc: 'Inspect React fiber tree' },
  sequence:    { script: 'sequence.ts',    desc: 'Run action sequence' },
  console:     { script: 'console.ts',     desc: 'Console logs' },
  network:     { script: 'network.ts',     desc: 'Network requests' },
  trace:       { script: 'trace.ts',       desc: 'Record trace' },
  video:       { script: 'video.ts',       desc: 'Manage videos' },
  tab:         { script: 'tab.ts',         desc: 'Manage tabs' },
  status:      { script: 'status.ts',      desc: 'Session status' },
};

// Help
if (!command || command === 'help' || command === '--help') {
  const helpTopic = restArgs[0];
  if (helpTopic === 'seq' || helpTopic === 'sequence') {
    console.log(renderSequenceHelp());
    process.exit(0);
  }

  console.log(renderMainHelp());
  process.exit(0);
}

if (command === 'sequence' && ['help', '--help', '-h'].includes(restArgs[0] || '')) {
  console.log(renderSequenceHelp());
  process.exit(0);
}

// `pw <command> --help|-h`: print usage and exit *before* any action dispatch, so a
// help request never spawns the action script (a defaulted action like `scroll` would
// otherwise run against the bound session's page). Global `pw help`/`pw --help` are
// handled above and never reach here.
if (wantsHelp(restArgs)) {
  console.log(renderCommandUsage(command));
  process.exit(0);
}

if (command === 'run') {
  const scriptInput = restArgs[0];
  if (!scriptInput) {
    console.log(JSON.stringify({ success: false, error: 'Usage: pw run <script.ts|script.js> [args...]' }));
    process.exit(1);
  }

  const scriptPath = resolveRunScriptPath(scriptInput, process.cwd());
  if (!scriptPath) {
    const tried = buildRunScriptCandidates(scriptInput, process.cwd()).map(path => path.replace(`${process.cwd()}/`, './'));
    console.log(JSON.stringify({
      success: false,
      error: `Script "${scriptInput}" not found. Tried: ${tried.join(', ')}`,
    }));
    process.exit(1);
  }

  const result = spawnScript(scriptPath, restArgs.slice(1));
  process.exit(result.status ?? 1);
}

// --- agent ---
if (command === 'agent') {
  const subcommand = restArgs[0];
  if (subcommand !== 'skill') {
    console.error('Usage: pw agent skill [--all|--browse|--launch|--test|--close]');
    process.exit(1);
  }

  const skillFlag = restArgs.find(a => a.startsWith('--'))?.replace(/^--/, '');
  if (!skillFlag) {
    console.log(renderAgentSkillIndex());
    process.exit(0);
  }

  if (skillFlag === 'all') {
    console.log(renderAllAgentSkills());
    process.exit(0);
  }

  if (!Object.prototype.hasOwnProperty.call(AGENT_SKILLS, skillFlag)) {
    console.error(`Unknown agent skill: ${skillFlag}\n\n${renderAgentSkillIndex()}`);
    process.exit(1);
  }

  console.log(renderAgentSkill(skillFlag));
  process.exit(0);
}

// --- analyze ---
if (command === 'analyze') {
  const { analyze } = await import('./analyze.js');
  const result = analyze();
  console.log(JSON.stringify({ success: true, data: result }));
  process.exit(0);
}

// --- clean ---
if (command === 'clean') {
  const target = restArgs.filter(a => !a.startsWith('--'))[0];
  const { cleanDead, cleanStale, cleanOrphans, cleanStaleLocks, cleanOrphanLocks, cleanAll } = await import('./clean.js');

  let result;
  switch (target) {
    case 'dead':          result = { cleaned: { dead: cleanDead() } }; break;
    case 'stale':         result = { cleaned: { stale: cleanStale() } }; break;
    case 'orphans':       result = { cleaned: { orphaned: cleanOrphans() } }; break;
    case 'stale-locks':   result = { cleaned: { staleLocks: cleanStaleLocks() } }; break;
    case 'orphan-locks':  result = { cleaned: { orphanLocks: cleanOrphanLocks() } }; break;
    case 'all':           result = cleanAll(); break;
    default:
      console.log(JSON.stringify({ success: false, error: 'Usage: pw clean <dead|stale|orphans|stale-locks|orphan-locks|all>' }));
      process.exit(1);
  }

  console.log(JSON.stringify({ success: true, data: result }));
  process.exit(0);
}

// --- rary ---
if (command === 'rary') {
  const { raryRouter } = await import('./rary-commands.js');
  const result = await raryRouter(restArgs);
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

// --- launch ---
if (command === 'launch') {
  const { launchSession } = await import('./session-commands.js');
  const result = await launchSession(restArgs);
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

// --- use ---
if (command === 'use') {
  const { useSession } = await import('./session-commands.js');
  const name = restArgs.filter(a => !a.startsWith('--'))[0];
  const result = await useSession(name, { pin: restArgs.includes('--pin') });
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

// --- sessions ---
if (command === 'sessions') {
  const { listSessionsCommand } = await import('./session-commands.js');
  const result = listSessionsCommand();
  console.log(JSON.stringify(result));
  process.exit(0);
}

// --- browsers ---
if (command === 'browsers') {
  const { listBrowsersCommand } = await import('./browsers-command.js');
  console.log(JSON.stringify(listBrowsersCommand()));
  process.exit(0);
}

// --- close ---
if (command === 'close') {
  const { closeSession } = await import('./session-commands.js');
  const result = await closeSession(restArgs);
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

// --- gui ---
if (command === 'gui') {
  // Resolve session for GUI
  const { resolveSession } = await import('./session.js');
  const sessionFlag = restArgs.find(a => a.startsWith('--session='))?.slice('--session='.length);
  try {
    const session = resolveSession(sessionFlag);
    const { isInstalled } = await import('./rary.js');
    if (!isInstalled('pw-monitor')) {
      console.log(JSON.stringify({ success: false, error: 'pw-monitor extension required. Install with: pw rary get <repo> && pw rary put pw-monitor' }));
      process.exit(1);
    }
    const guiScript = join(homedir(), '.playwright-state', 'toybox', 'pw-monitor', 'src', 'gui', 'server.ts');
    if (!existsSync(guiScript)) {
      console.log(JSON.stringify({ success: false, error: 'pw-monitor GUI not found. Update pw-monitor extension.' }));
      process.exit(1);
    }
    const portArg = restArgs.find(a => a.startsWith('--port=')) || '--port=3100';
    const result = spawnScript(guiScript, [session.name, portArg]);
    process.exit(result.status ?? 1);
  } catch (err: any) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

// --- Regular script commands ---
const cmd = COMMANDS[command];
if (!cmd) {
  console.error(`Unknown command: ${command}\nRun 'pw help' for usage.`);
  process.exit(1);
}

// Local first, global fallback
const localScript = join(process.cwd(), 'scripts', 'playwright', cmd.script);
const globalScript = join(SCRIPTS_DIR, cmd.script);
const scriptPath = existsSync(localScript) ? localScript : globalScript;

try {
  const result = spawnScript(scriptPath, restArgs);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} catch {
  process.exit(1);
}
