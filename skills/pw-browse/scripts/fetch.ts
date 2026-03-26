// fetch.ts — HTTP request from browser context (with cookies/auth)
// Usage:
//   pw fetch GET /api/projects
//   pw fetch POST /api/projects '{"name":"test"}'
//   pw fetch PUT /api/projects/1 '{"name":"updated"}'
//   pw fetch DELETE /api/projects/1
//   pw fetch GET https://api.example.com/data
import { run } from './common.js';

run(async ({ page, args }) => {
  const method = (args[0] || 'GET').toUpperCase();
  const url = args[1];
  const body = args[2];

  if (!url) return { success: false, error: 'Usage: fetch.ts <GET|POST|PUT|DELETE|PATCH> <url> [body-json]' };

  // relative URL → resolve against current page origin
  const fullUrl = url.startsWith('http') ? url : url;

  const result = await page.evaluate(
    async ({ method, url, body }) => {
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (body && method !== 'GET') {
        opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      try {
        const res = await fetch(url, opts);
        const contentType = res.headers.get('content-type') || '';
        let data: any;
        if (contentType.includes('json')) {
          data = await res.json();
        } else {
          data = await res.text();
          if (data.length > 2000) data = data.substring(0, 2000) + '...(truncated)';
        }
        return {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          data,
        };
      } catch (err: any) {
        return { status: 0, error: err.message };
      }
    },
    { method, url: fullUrl, body },
  );

  return {
    success: (result as any).status >= 200 && (result as any).status < 400,
    data: result,
  };
});
