#!/usr/bin/env npx tsx
// pw CLI — Playwright Skill unified command
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const SCRIPTS_DIR = resolve(import.meta.dirname || __dirname, '.');
const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1).join(' ');

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
  submit:      { script: 'submit.ts',      desc: 'Submit form' },
  copy:        { script: 'copy.ts',        desc: 'Copy text/HTML' },
  attr:        { script: 'attr.ts',        desc: 'Read/write DOM attribute' },
  find:        { script: 'find.ts',        desc: 'Query DOM elements' },
  wait:        { script: 'wait.ts',        desc: 'Wait for condition' },
  fetch:       { script: 'fetch.ts',       desc: 'HTTP request (with auth)' },
  evaluate:    { script: 'evaluate.ts',    desc: 'Run JavaScript' },
  sequence:    { script: 'sequence.ts',    desc: 'Run action sequence' },
  console:     { script: 'console.ts',     desc: 'Console logs' },
  network:     { script: 'network.ts',     desc: 'Network requests' },
  tab:         { script: 'tab.ts',         desc: 'Manage tabs' },
  status:      { script: 'status.ts',      desc: 'Session status' },
};

// Help
if (!command || command === 'help' || command === '--help') {
  console.log(`
pw — Playwright CLI Skill

Usage: pw <command> [args...]

Commands:
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
  submit [form-selector] [--wait=/url]       Submit form
  copy <selector> [--format=text|html|outer] Copy text/HTML from element
  attr <selector> <name> [--set=value]       Read/write DOM attribute
  find <selector> [--detail=tag|class|full]  Query DOM elements
  wait <ms|HH:MM|url|selector> [--attr --value] Wait for condition
  fetch <METHOD> <url> [body-json]           HTTP request with auth
  evaluate <js-expression>                   Run JavaScript in page
  sequence <json|file>                       Run action sequence
  console [inject|dump|clear|tail]           Console log capture
  network [inject|dump|clear|tail|find]      Network request capture
  tab [new|list|close] [args...]             Manage browser tabs
  status [current|pages|all]                 Session status
  close                                      Close browser
  help                                       Show this help

Global flags:
  --tab=N        Target specific tab (default: 0)
  --headed       Show browser window
  --viewport=WxH Viewport size (default: 1920x1080)
`.trim());
  process.exit(0);
}

// Close is special
if (command === 'close') {
  const stateDir = resolve(process.cwd(), '.playwright-state');
  const portFile = join(stateDir, 'cdp-port.txt');
  try {
    if (existsSync(portFile)) {
      const { readFileSync, unlinkSync } = await import('fs');
      const port = readFileSync(portFile, 'utf-8').trim();
      if (process.platform === 'win32') {
        execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F 2>nul`, { stdio: 'ignore', shell: 'cmd.exe' });
      } else {
        execSync(`lsof -ti :${port} | xargs kill 2>/dev/null || true`, { stdio: 'ignore' });
      }
      unlinkSync(portFile);
    }
    console.log(JSON.stringify({ success: true, data: 'Browser closed' }));
  } catch {
    console.log(JSON.stringify({ success: true, data: 'No browser to close' }));
  }
  process.exit(0);
}

// Run script
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
  execSync(`npx tsx "${scriptPath}" ${rest}`, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch {
  process.exit(1);
}
