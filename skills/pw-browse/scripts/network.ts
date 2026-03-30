// ~/.claude/skills/pw-browse/scripts/network.ts
// Inject fetch/XHR patching into the browser and dump collected network logs to a file
import { run, ensureStateDir, hasFlag } from './common.js';
import { join, resolve } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const LOG_FILE = join(STATE_DIR, 'network.log');
const NDJSON_FILE = join(STATE_DIR, 'network.ndjson');

// Whitelist: only these headers are shown by default. Everything else → [REDACTED].
const SAFE_HEADERS = new Set([
  'content-type', 'content-length', 'accept', 'accept-language',
  'user-agent', 'cache-control', 'host', 'origin', 'referer',
]);

const MAX_BODY_LENGTH = 5000;

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    masked[key] = SAFE_HEADERS.has(key.toLowerCase()) ? value : '[REDACTED]';
  }
  return masked;
}

/**
 * Body summary for default (non-raw) mode.
 * JSON: show keys + types only. Non-JSON: content-type + length.
 */
function summarizeBody(text: string): string {
  try {
    const obj = JSON.parse(text);
    const summarize = (o: any): any => {
      if (Array.isArray(o)) return `[Array(${o.length})]`;
      if (o && typeof o === 'object') {
        const result: any = {};
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === 'object' && v !== null) result[k] = summarize(v);
          else result[k] = `[${typeof v}]`;
        }
        return result;
      }
      return `[${typeof o}]`;
    };
    return JSON.stringify(summarize(obj));
  } catch {
    return `[non-JSON, ${text.length} bytes]`;
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.substring(0, limit) + '...(truncated)' : text;
}

const INJECT_SCRIPT = `
if (!window.__PW_NETWORK_PATCHED) {
  window.__PW_NETWORK_PATCHED = true;
  window.__PW_NETWORK = window.__PW_NETWORK || [];

  // Patch fetch
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method || 'GET';
    let reqBody = null;
    try { reqBody = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : '[FormData/Blob]') : null; } catch { reqBody = init?.body; }
    const ts = Date.now();
    try {
      const res = await origFetch(input, init);
      const clone = res.clone();
      let resBody = null;
      try { resBody = await clone.json(); } catch { try { resBody = await clone.text(); } catch {} }
      window.__PW_NETWORK.push({ type: 'fetch', method, url, status: res.status, reqBody, resBody, ts });
      return res;
    } catch (err) {
      window.__PW_NETWORK.push({ type: 'fetch', method, url, status: 0, error: err.message, reqBody, ts });
      throw err;
    }
  };

  // Patch XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__pw = { method, url, ts: Date.now() };
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const pw = this.__pw || {};
    let reqBody = null;
    try { reqBody = body ? JSON.parse(body) : null; } catch { reqBody = body; }
    this.addEventListener('load', () => {
      let resBody = null;
      try { resBody = JSON.parse(this.responseText); } catch { resBody = this.responseText?.substring(0, 500); }
      window.__PW_NETWORK.push({ type: 'xhr', method: pw.method, url: pw.url, status: this.status, reqBody, resBody, ts: pw.ts });
    });
    this.addEventListener('error', () => {
      window.__PW_NETWORK.push({ type: 'xhr', method: pw.method, url: pw.url, status: 0, error: 'Network error', reqBody, ts: pw.ts });
    });
    return origSend.call(this, body);
  };
}
`;

run(async ({ page, args }) => {
  const command = args[0] || 'dump'; // inject | dump | clear | tail | find
  const { resolveRedactionLevel } = await import('./settings.js');
  const { parseFlag: pf } = await import('./common.js');
  const cliLevel = pf(process.argv.slice(2), 'redaction-level');
  const cliRaw = hasFlag(process.argv.slice(2), 'raw');
  const level = resolveRedactionLevel({ cliRaw, cliLevel });
  const raw = level === 'raw';

  switch (command) {
    case 'inject': {
      await page.evaluate(INJECT_SCRIPT);
      return { success: true, data: { message: 'Network logging injected' } };
    }

    case 'dump': {
      const patched = await page.evaluate('!!window.__PW_NETWORK_PATCHED');
      if (!patched) await page.evaluate(INJECT_SCRIPT);

      const logs = await page.evaluate('window.__PW_NETWORK || []') as any[];
      ensureStateDir();

      const formatBody = (str: string): string => {
        if (raw) return str;
        if (level === 'verbose') return str.length > MAX_BODY_LENGTH ? str.slice(0, MAX_BODY_LENGTH) + '...(truncated)' : str;
        return summarizeBody(str); // strict
      };

      const lines = logs.map((l: any) => {
        const reqStr = l.reqBody ? JSON.stringify(l.reqBody) : '';
        const req = reqStr ? ` req=${formatBody(reqStr)}` : '';
        const resStr = l.resBody ? JSON.stringify(l.resBody) : '';
        const res = resStr ? ` res=${formatBody(resStr)}` : '';
        const err = l.error ? ` error=${l.error}` : '';
        const hdrs = l.headers ? ` headers=${JSON.stringify(raw ? l.headers : maskHeaders(l.headers))}` : '';
        return `[${new Date(l.ts).toISOString()}] [${l.type.toUpperCase()}] ${l.method} ${l.url} → ${l.status}${req}${res}${hdrs}${err}`;
      }).join('\n');

      if (lines) writeFileSync(LOG_FILE, lines + '\n', { flag: 'a' });

      const { writeNdjsonEntry } = await import('./network-utils.js');
      for (const l of logs) {
        writeNdjsonEntry(NDJSON_FILE, {
          timestamp: new Date(l.ts).toISOString(),
          type: l.type,
          method: l.method,
          url: l.url,
          status: l.status,
          requestBody: l.reqBody ? (typeof l.reqBody === 'string' ? l.reqBody : JSON.stringify(l.reqBody)) : undefined,
          responseBody: l.resBody ? (typeof l.resBody === 'string' ? l.resBody : JSON.stringify(l.resBody)) : undefined,
          redactionLevel: level,
        });
      }

      await page.evaluate('window.__PW_NETWORK = []');

      return {
        success: true,
        data: { dumped: logs.length, file: LOG_FILE, redactionLevel: level, ...(raw ? { warnings: ['Raw mode: sensitive data may be written to disk unmasked'] } : {}) },
      };
    }

    case 'clear': {
      await page.evaluate('window.__PW_NETWORK = []');
      if (existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');
      if (existsSync(NDJSON_FILE)) writeFileSync(NDJSON_FILE, '');
      return { success: true, data: { message: 'Network logs cleared' } };
    }

    case 'tail': {
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const last20 = allLines.slice(-20);
      return { success: true, data: { total: allLines.length, lines: last20 } };
    }

    case 'find': {
      const pattern = args[1];
      if (!pattern) return { success: false, error: 'Usage: network.ts find <url-pattern> [--body] [--json] [--body-limit=N]' };

      const wantBody = hasFlag(process.argv.slice(2), 'body');
      const wantJson = hasFlag(process.argv.slice(2), 'json');
      const bodyLimitStr = pf(process.argv.slice(2), 'body-limit');
      const bodyLimit = bodyLimitStr ? (parseInt(bodyLimitStr) || 5000) : 5000;

      if (wantBody || wantJson) {
        const { readNdjsonEntries } = await import('./network-utils.js');
        const entries = readNdjsonEntries(NDJSON_FILE, pattern, bodyLimit);
        return {
          success: true,
          data: {
            total: entries.length,
            entries: entries.slice(-20),
            bodyLimit,
            ...(raw ? { warnings: ['Raw mode: bodies may contain sensitive data'] } : {}),
          },
        };
      }

      // Default: plain text search (existing behavior unchanged)
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const matched = content.trim().split('\n').filter(l => l.includes(pattern));
      return { success: true, data: { total: matched.length, lines: matched.slice(-20) } };
    }

    default:
      return { success: false, error: 'Usage: network.ts [inject|dump|clear|tail|find <pattern>]' };
  }
});
