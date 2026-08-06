import type { Page } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { ensureStateDir } from './common.js';
import { resolveRedactionLevel } from './settings.js';
import { writeNdjsonEntry, readNdjsonEntries } from './network-utils.js';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const LOG_FILE = join(STATE_DIR, 'network.log');
const NDJSON_FILE = join(STATE_DIR, 'network.ndjson');

const SAFE_HEADERS = new Set([
  'content-type', 'content-length', 'accept', 'accept-language',
  'user-agent', 'cache-control', 'host', 'origin', 'referer',
]);

const MAX_BODY_LENGTH = 5000;

export interface NetworkCommandOptions {
  command?: string;
  pattern?: string;
  raw?: boolean;
  redactionLevel?: string;
  body?: boolean;
  json?: boolean;
  bodyLimit?: number;
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    masked[key] = SAFE_HEADERS.has(key.toLowerCase()) ? value : '[REDACTED]';
  }
  return masked;
}

function summarizeBody(text: string): string {
  try {
    const obj = JSON.parse(text);
    const summarize = (value: any): any => {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      if (value && typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const [key, nested] of Object.entries(value)) {
          if (typeof nested === 'object' && nested !== null) result[key] = summarize(nested);
          else result[key] = `[${typeof nested}]`;
        }
        return result;
      }
      return `[${typeof value}]`;
    };
    return JSON.stringify(summarize(obj));
  } catch {
    return `[non-JSON, ${text.length} bytes]`;
  }
}

export const NETWORK_INJECT_SCRIPT = `
if (!window.__PW_NETWORK_PATCHED) {
  window.__PW_NETWORK_PATCHED = true;

  // Recovery from sessionStorage (persistent across navigations within same tab)
  try {
    const saved = sessionStorage.getItem('__PW_NETWORK_BACKUP');
    window.__PW_NETWORK = saved ? JSON.parse(saved) : [];
    sessionStorage.removeItem('__PW_NETWORK_BACKUP');
  } catch {
    window.__PW_NETWORK = window.__PW_NETWORK || [];
  }

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
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      // Streaming responses (SSE): reading a clone with .text()/.json() would block
      // until the stream ends and can hang the page, so we wrap the body in a
      // passthrough that logs each chunk as the page reads it. The record is mutated
      // live, so a mid-stream 'pw network dump' sees the partial content so far.
      if (ct.indexOf('text/event-stream') !== -1 && res.body) {
        const rec = { type: 'fetch', method, url, status: res.status, reqBody, resBody: '', streaming: true, partial: true, ts };
        window.__PW_NETWORK.push(rec);
        // Passthrough: ONE reader drives both the page and the log, so the log
        // captures exactly what the page consumes. (tee() with a second reader
        // could truncate when the page cancels early or reads at a different rate.)
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const LIMIT = 100000;
        let text = '';
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const r = await reader.read();
              if (r.done) { rec.partial = false; controller.close(); return; }
              if (text.length < LIMIT) { text += decoder.decode(r.value, { stream: true }); rec.resBody = text; }
              else { rec.truncated = true; }
              controller.enqueue(r.value);
            } catch (e) { rec.error = String(e && e.message || e); controller.error(e); }
          },
          cancel(reason) { try { reader.cancel(reason); } catch (e) {} },
        });
        return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
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

  window.addEventListener('beforeunload', () => {
    try { sessionStorage.setItem('__PW_NETWORK_BACKUP', JSON.stringify(window.__PW_NETWORK.slice(-500))); } catch {}
  });
}
`;

export async function runNetworkCommand(
  page: Page,
  options: NetworkCommandOptions = {},
): Promise<{ success: boolean; data?: any; error?: string }> {
  const command = options.command || 'dump';
  const level = resolveRedactionLevel({
    cliRaw: options.raw,
    cliLevel: options.redactionLevel,
  });
  const raw = level === 'raw';

  switch (command) {
    case 'inject': {
      await page.evaluate(NETWORK_INJECT_SCRIPT);
      return { success: true, data: { message: 'Network logging injected' } };
    }

    case 'dump': {
      const patched = await page.evaluate('!!window.__PW_NETWORK_PATCHED');
      if (!patched) await page.evaluate(NETWORK_INJECT_SCRIPT);

      const logs = await page.evaluate('window.__PW_NETWORK || []') as any[];
      ensureStateDir();

      const formatBody = (text: string): string => {
        if (raw) return text;
        if (level === 'verbose') return text.length > MAX_BODY_LENGTH ? text.slice(0, MAX_BODY_LENGTH) + '...(truncated)' : text;
        return summarizeBody(text);
      };

      const lines = logs.map((entry: any) => {
        const reqStr = entry.reqBody ? JSON.stringify(entry.reqBody) : '';
        const req = reqStr ? ` req=${formatBody(reqStr)}` : '';
        const resStr = entry.resBody ? JSON.stringify(entry.resBody) : '';
        const res = resStr ? ` res=${formatBody(resStr)}` : '';
        const err = entry.error ? ` error=${entry.error}` : '';
        const stream = entry.streaming ? ` [stream${entry.partial ? ':partial' : ':done'}${entry.truncated ? ':truncated' : ''}]` : '';
        const headers = entry.headers ? ` headers=${JSON.stringify(raw ? entry.headers : maskHeaders(entry.headers))}` : '';
        return `[${new Date(entry.ts).toISOString()}] [${entry.type.toUpperCase()}] ${entry.method} ${entry.url} -> ${entry.status}${stream}${req}${res}${headers}${err}`;
      }).join('\n');

      if (lines) writeFileSync(LOG_FILE, lines + '\n', { flag: 'a' });

      for (const entry of logs) {
        writeNdjsonEntry(NDJSON_FILE, {
          timestamp: new Date(entry.ts).toISOString(),
          type: entry.type,
          method: entry.method,
          url: entry.url,
          status: entry.status,
          requestBody: entry.reqBody ? (typeof entry.reqBody === 'string' ? entry.reqBody : JSON.stringify(entry.reqBody)) : undefined,
          responseBody: entry.resBody ? (typeof entry.resBody === 'string' ? entry.resBody : JSON.stringify(entry.resBody)) : undefined,
          redactionLevel: level,
        });
      }

      await page.evaluate('window.__PW_NETWORK = []; try { sessionStorage.removeItem("__PW_NETWORK_BACKUP"); } catch {}');

      return {
        success: true,
        data: { dumped: logs.length, file: LOG_FILE, redactionLevel: level, ...(raw ? { warnings: ['Raw mode: sensitive data may be written to disk unmasked'] } : {}) },
      };
    }

    case 'clear': {
      await page.evaluate('window.__PW_NETWORK = []; try { sessionStorage.removeItem("__PW_NETWORK_BACKUP"); } catch {}');
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
      const pattern = options.pattern;
      if (!pattern) return { success: false, error: 'Usage: network.ts find <url-pattern> [--body] [--json] [--body-limit=N]' };

      const bodyLimit = options.bodyLimit || 5000;
      if (options.body || options.json) {
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

      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const matched = content.trim().split('\n').filter(line => line.includes(pattern));
      return { success: true, data: { total: matched.length, lines: matched.slice(-20) } };
    }

    default:
      return { success: false, error: 'Usage: network.ts [inject|dump|clear|tail|find <pattern>]' };
  }
}
