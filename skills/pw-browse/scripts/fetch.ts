// fetch.ts — HTTP request from browser context (with cookies/auth)
// Usage:
//   pw fetch GET /api/projects
//   pw fetch POST /api/projects '{"name":"test"}'
//   pw fetch PUT /api/projects/1 '{"name":"updated"}'
//   pw fetch DELETE /api/projects/1
//   pw fetch GET https://api.example.com/data
//   pw fetch GET /api/members --auth='$ret'
import { run, parseFlag } from './common.js';
import { actionFetch } from './actions.js';

run(async ({ page, args }) => {
  const cliArgs = process.argv.slice(2);
  const method = (args[0] || 'GET').toUpperCase();
  const url = args[1];
  const body = args[2];
  const auth = parseFlag(cliArgs, 'auth');
  const credentials = parseFlag(cliArgs, 'credentials');

  if (!url) return { success: false, error: 'Usage: fetch.ts <GET|POST|PUT|DELETE|PATCH> <url> [body-json] [--auth=TOKEN] [--credentials=include|same-origin|omit]' };

  const actionArgs: Record<string, any> = { 0: method, 1: url };
  if (body !== undefined) actionArgs[2] = body;
  if (auth !== undefined) actionArgs.auth = auth;
  if (credentials !== undefined) actionArgs.credentials = credentials;

  const { result } = await actionFetch(page, actionArgs);

  return {
    success: (result as any).status >= 200 && (result as any).status < 400,
    data: result,
  };
});
