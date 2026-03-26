// fetch.ts — HTTP request from browser context (with cookies/auth)
// Usage:
//   pw fetch GET /api/projects
//   pw fetch POST /api/projects '{"name":"test"}'
//   pw fetch PUT /api/projects/1 '{"name":"updated"}'
//   pw fetch DELETE /api/projects/1
//   pw fetch GET https://api.example.com/data
import { run } from './common.js';
import { actionFetch } from './actions.js';

run(async ({ page, args }) => {
  const method = (args[0] || 'GET').toUpperCase();
  const url = args[1];
  const body = args[2];

  if (!url) return { success: false, error: 'Usage: fetch.ts <GET|POST|PUT|DELETE|PATCH> <url> [body-json]' };

  const { result } = await actionFetch(page, [method, url, ...(body ? [body] : [])]);

  return {
    success: (result as any).status >= 200 && (result as any).status < 400,
    data: result,
  };
});
