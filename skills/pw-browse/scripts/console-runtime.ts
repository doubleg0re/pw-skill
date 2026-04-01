import type { Page } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { ensureStateDir } from './common.js';
import { resolveRedactionLevel } from './settings.js';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const LOG_FILE = join(STATE_DIR, 'console.log');
const MAX_LOG_ENTRY_LENGTH = 2000;

export interface ConsoleCommandOptions {
  command?: string;
  filters?: string[];
  raw?: boolean;
  redactionLevel?: string;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.substring(0, limit) + '...(truncated)' : text;
}

export const CONSOLE_INJECT_SCRIPT = `
if (!window.__PW_CONSOLE_PATCHED) {
  window.__PW_CONSOLE_PATCHED = true;
  
  // Recovery from sessionStorage (persistent across navigations within same tab)
  try {
    const saved = sessionStorage.getItem('__PW_LOGS_BACKUP');
    window.__PW_LOGS = saved ? JSON.parse(saved) : [];
    sessionStorage.removeItem('__PW_LOGS_BACKUP');
  } catch {
    window.__PW_LOGS = [];
  }

  const orig = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach(type => {
    orig[type] = console[type].bind(console);
    console[type] = (...args) => {
      let text = '';
      try {
        text = args.map(a => {
          if (typeof a === 'object' && a !== null) {
            try { return JSON.stringify(a); } catch { return String(a); }
          }
          return String(a);
        }).join(' ');
      } catch { text = '[Unserializable log]'; }
      
      window.__PW_LOGS.push({ type, text, ts: Date.now() });
      orig[type](...args);
    };
  });

  window.addEventListener('beforeunload', () => {
    try { sessionStorage.setItem('__PW_LOGS_BACKUP', JSON.stringify(window.__PW_LOGS.slice(-1000))); } catch {}
  });

  window.addEventListener('error', (e) => {
    window.__PW_LOGS.push({ type: 'error', text: e.message, ts: Date.now() });
  });

  window.addEventListener('unhandledrejection', (e) => {
    window.__PW_LOGS.push({ type: 'error', text: 'Unhandled: ' + String(e.reason), ts: Date.now() });
  });
}
`;

export function toMatcher(pattern: string): (line: string) => boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    const re = new RegExp(pattern.slice(1, -1), 'i');
    return (line) => re.test(line);
  }
  const lower = pattern.toLowerCase();
  return (line) => line.toLowerCase().includes(lower);
}

export function filterLines(lines: string[], filters: string[]): string[] {
  const includes: ((line: string) => boolean)[] = [];
  const excludes: ((line: string) => boolean)[] = [];

  for (const arg of filters) {
    if (arg.startsWith('+')) includes.push(toMatcher(arg.slice(1)));
    else if (arg.startsWith('-') && !arg.startsWith('--')) excludes.push(toMatcher(arg.slice(1)));
  }

  if (includes.length === 0 && excludes.length === 0) return lines;

  return lines.filter(line => {
    if (includes.length > 0 && !includes.some(fn => fn(line))) return false;
    if (excludes.length > 0 && excludes.some(fn => fn(line))) return false;
    return true;
  });
}

export async function runConsoleCommand(
  page: Page,
  options: ConsoleCommandOptions = {},
): Promise<{ success: boolean; data?: any; error?: string }> {
  const command = options.command || 'dump';
  const filters = options.filters || [];
  const redactionLevel = resolveRedactionLevel({
    cliRaw: options.raw,
    cliLevel: options.redactionLevel,
  });
  const raw = redactionLevel === 'raw';

  switch (command) {
    case 'inject': {
      await page.evaluate(CONSOLE_INJECT_SCRIPT);
      return { success: true, data: { message: 'Console logging injected' } };
    }

    case 'dump': {
      const patched = await page.evaluate('!!window.__PW_CONSOLE_PATCHED');
      if (!patched) await page.evaluate(CONSOLE_INJECT_SCRIPT);

      const logs = await page.evaluate('window.__PW_LOGS || []') as any[];
      ensureStateDir();

      let formatted = logs.map((entry: any) => {
        const line = `[${new Date(entry.ts).toISOString()}] [${entry.type.toUpperCase()}] ${entry.text}`;
        return raw ? line : truncate(line, MAX_LOG_ENTRY_LENGTH);
      });

      formatted = filterLines(formatted, filters);

      const lines = formatted.join('\n');
      if (lines) writeFileSync(LOG_FILE, lines + '\n', { flag: 'a' });

      await page.evaluate('window.__PW_LOGS = []');

      return {
        success: true,
        data: { dumped: logs.length, file: LOG_FILE, ...(raw ? { warnings: ['Raw mode: log entries written without truncation'] } : {}) },
      };
    }

    case 'clear': {
      await page.evaluate('window.__PW_LOGS = []');
      if (existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');
      return { success: true, data: { message: 'Logs cleared' } };
    }

    case 'tail': {
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const filtered = filterLines(allLines, filters);
      const last20 = filtered.slice(-20);
      return { success: true, data: { total: filtered.length, lines: last20 } };
    }

    default:
      return { success: false, error: 'Usage: console.ts [inject|dump|clear|tail]' };
  }
}
