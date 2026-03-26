// ~/.claude/skills/pw-browse/scripts/network.ts
// 브라우저에 fetch/XHR 패칭을 inject하고, 수집된 네트워크 로그를 파일로 덤프
import { run, ensureStateDir } from './common.js';
import { join, resolve } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const LOG_FILE = join(STATE_DIR, 'network.log');

const INJECT_SCRIPT = `
if (!window.__PW_NETWORK_PATCHED) {
  window.__PW_NETWORK_PATCHED = true;
  window.__PW_NETWORK = window.__PW_NETWORK || [];

  // fetch 패칭
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

  // XMLHttpRequest 패칭
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

  switch (command) {
    case 'inject': {
      await page.evaluate(INJECT_SCRIPT);
      return { success: true, data: 'Network logging injected' };
    }

    case 'dump': {
      const patched = await page.evaluate('!!window.__PW_NETWORK_PATCHED');
      if (!patched) await page.evaluate(INJECT_SCRIPT);

      const logs = await page.evaluate('window.__PW_NETWORK || []') as any[];
      ensureStateDir();

      const lines = logs.map((l: any) => {
        const req = l.reqBody ? ` req=${JSON.stringify(l.reqBody)}` : '';
        const res = l.resBody ? ` res=${JSON.stringify(l.resBody).substring(0, 300)}` : '';
        const err = l.error ? ` error=${l.error}` : '';
        return `[${new Date(l.ts).toISOString()}] [${l.type.toUpperCase()}] ${l.method} ${l.url} → ${l.status}${req}${res}${err}`;
      }).join('\n');

      if (lines) writeFileSync(LOG_FILE, lines + '\n', { flag: 'a' });
      await page.evaluate('window.__PW_NETWORK = []');

      return { success: true, data: { dumped: logs.length, file: LOG_FILE } };
    }

    case 'clear': {
      await page.evaluate('window.__PW_NETWORK = []');
      if (existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');
      return { success: true, data: 'Network logs cleared' };
    }

    case 'tail': {
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const last20 = allLines.slice(-20);
      return { success: true, data: { total: allLines.length, lines: last20 } };
    }

    case 'find': {
      // args[1]로 URL 패턴 필터링
      const pattern = args[1];
      if (!pattern) return { success: false, error: 'Usage: network.ts find <url-pattern>' };
      if (!existsSync(LOG_FILE)) return { success: true, data: { lines: [] } };
      const content = readFileSync(LOG_FILE, 'utf-8');
      const matched = content.trim().split('\n').filter(l => l.includes(pattern));
      return { success: true, data: { total: matched.length, lines: matched.slice(-20) } };
    }

    default:
      return { success: false, error: 'Usage: network.ts [inject|dump|clear|tail|find <pattern>]' };
  }
});
