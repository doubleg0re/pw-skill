#!/usr/bin/env npx tsx
// pw CLI — Playwright Skill unified command
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const SCRIPTS_DIR = resolve(import.meta.dirname || __dirname, '.');
const args = process.argv.slice(2);

// --inline mode: delegate to pwi
if (args[0] === '--inline' || args[0] === '-i') {
  const pwiScript = join(SCRIPTS_DIR, 'pwi.ts');
  const result = spawnSync(process.execPath, [...process.execArgv, pwiScript, ...args.slice(1)], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 1);
}

// :: chaining: forward to pwi if all segments are browser actions
if (args.includes('::')) {
  const pwiScript = join(SCRIPTS_DIR, 'pwi.ts');
  const result = spawnSync(process.execPath, [...process.execArgv, pwiScript, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 1);
}

const command = args[0];
const restArgs = args.slice(1);

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
  screenshot:  { script: 'screenshot.ts',  desc: 'Capture page' },
  click:       { script: 'click.ts',       desc: 'Click element' },
  dblclick:    { script: 'dblclick.ts',    desc: 'Double-click element' },
  hover:       { script: 'hover.ts',       desc: 'Hover over element' },
  drag:        { script: 'drag.ts',        desc: 'Drag and drop' },
  scroll:      { script: 'scroll.ts',      desc: 'Scroll page' },
  fill:        { script: 'fill.ts',        desc: 'Fill input field' },
  type:        { script: 'type.ts',        desc: 'Type on keyboard' },
  select:      { script: 'select.ts',      desc: 'Select dropdown option' },
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
  console.log(`
pw — Playwright CLI Skill

Usage: pw <command> [args...]

Session management:
  launch [url] [--name=N] [--resume=N]     Launch browser session
  use <name>                                Bind session to project
  sessions                                  List all sessions
  close [--session=N] [--all]               Close session(s)

Diagnostics:
  analyze                                   Diagnose sessions, bindings, artifacts
  clean <dead|stale|orphans|all>             Safe cleanup (broken pkgs → pw rary kick)

Package management (Larry's toybox):
  rary get <repo|path>                      Fetch a toy into the toybox
  rary toybox                               List installed packages
  rary peek <package>                       Inspect a package
  rary put <package>                        Activate an extension
  rary yoink <package>                      Deactivate an extension
  rary rolling <package>                    Run first-time setup
  rary destroy|kick <package>               Remove a package
  rary need-repair                          Check for broken packages

Browser actions:
  navigate <url> [--screenshot]              Go to URL
  screenshot [selector] [--full]             Capture page or element
  click <target> [--mode=selector|text|coord] Click element
  dblclick <target> [--mode=...]             Double-click element
  hover <target> [--mode=...]                Hover over element
  drag <source> <target> [--mode=...]        Drag and drop
  scroll <up|down|top|bottom|selector>       Scroll page
  fill <selector> <text>                     Fill input field
  type <text> [--delay=ms]                   Type on keyboard
  select <selector> [--value|--label|--index] Select dropdown option
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
  fetch <METHOD> <url> [body-json]           HTTP request with auth
  evaluate <js-expression>                   Run JavaScript in page
  sequence <json|file>                       Run action sequence

Debugging:
  console [inject|dump|clear|tail]           Console log capture
  network [inject|dump|clear|tail|find]      Network request capture
  trace [start|stop|view|status]             Record and view traces
  video [list|path|rename|clear]             Manage recorded videos
  tab [new|list|close] [args...]             Manage browser tabs

Global flags:
  --session=N    Target specific session (name or ID)
  --tab=N        Target specific tab (default: 0)
  --headed       Show browser window
  --viewport=WxH Viewport size (default: 1920x1080)
  --video[=name] Enable video recording
`.trim());
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
  const result = await useSession(name);
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

// --- close ---
if (command === 'close') {
  const { closeSession } = await import('./session-commands.js');
  const result = await closeSession(restArgs);
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
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
  const result = spawnSync(process.execPath, [...process.execArgv, scriptPath, ...restArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} catch {
  process.exit(1);
}
