// ~/.claude/skills/pw-browse/scripts/console.ts
// Inject console patching into the browser and dump collected logs to a file
import { run, ensureStateDir } from './common.js';
import { join, resolve } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const LOG_FILE = join(STATE_DIR, 'console.log');

const MAX_LOG_ENTRY_LENGTH = 2000;

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.substring(0, limit) + '...(truncated)' : text;
}

// Console patching code to inject into the browser
const INJECT_SCRIPT = `
if (!window.__PW_CONSOLE_PATCHED) {
  window.__PW_CONSOLE_PATCHED = true;
  window.__PW_LOGS = window.__PW_LOGS || [];
  const orig = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach(type => {
    orig[type] = console[type].bind(console);
    console[type] = (...args) => {
      window.__PW_LOGS.push({
        type,
        text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
        ts: Date.now()
      });
      orig[type](...args);
    };
  });
  window.addEventListener('error', (e) => {
    window.__PW_LOGS.push({ type: 'error', text: e.message, ts: Date.now() });
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__PW_LOGS.push({ type: 'error', text: 'Unhandled: ' + String(e.reason), ts: Date.now() });
  });
}
`;

run(async ({ page, args }) => {
  const command = args[0] || 'dump'; // inject | dump | clear | tail

  switch (command) {
    case 'inject': {
      await page.evaluate(INJECT_SCRIPT);
      return { success: true, data: 'Console logging injected' };
    }

    case 'dump': {
      // Auto-inject if not already injected
      const patched = await page.evaluate('!!window.__PW_CONSOLE_PATCHED');
      if (!patched) await page.evaluate(INJECT_SCRIPT);

      const logs = await page.evaluate('window.__PW_LOGS || []') as any[];
      ensureStateDir();

      // Append to file
      const lines = logs.map((l: any) =>
        truncate(`[${new Date(l.ts).toISOString()}] [${l.type.toUpperCase()}] ${l.text}`, MAX_LOG_ENTRY_LENGTH)
      ).join('\n');

      if (lines) writeFileSync(LOG_FILE, lines + '\n', { flag: 'a' });

      // Clear browser logs after dump
      await page.evaluate('window.__PW_LOGS = []');

      return { success: true, data: { dumped: logs.length, file: LOG_FILE } };
    }

    case 'clear': {
      await page.evaluate('window.__PW_LOGS = []');
      if (existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');
      return { success: true, data: 'Logs cleared' };
    }

    case 'tail': {
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const last20 = allLines.slice(-20);
      return { success: true, data: { total: allLines.length, lines: last20 } };
    }

    default:
      return { success: false, error: 'Usage: console.ts [inject|dump|clear|tail]' };
  }
});
