// submit.ts — Form submission (UI form or direct HTTP)
// Usage:
//   pw submit                                          # Press Enter
//   pw submit "#login-form"                            # Submit form by selector
//   pw submit "#login-form" --wait=/dashboard          # Submit + wait for URL
//   pw submit --url=/api/projects --method=POST --body='{"name":"test"}' --wait=/projects
import { run, parseFlag, screenshotPath } from './common.js';
import { actionSubmit } from './actions.js';

run(async ({ page, args, session }) => {
  const selector = args[0];
  const waitUrl = parseFlag(process.argv.slice(2), 'wait');
  const url = parseFlag(process.argv.slice(2), 'url');
  const method = parseFlag(process.argv.slice(2), 'method') || 'POST';
  const body = parseFlag(process.argv.slice(2), 'body');

  if (url) {
    // Direct HTTP submit
    const response = await page.evaluate(
      async ({ url, method, body }) => {
        const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (body && method !== 'GET') opts.body = body;
        const res = await fetch(url, opts);
        const contentType = res.headers.get('content-type') || '';
        let data: any;
        if (contentType.includes('json')) data = await res.json();
        else data = await res.text();
        return { status: res.status, data };
      },
      { url, method, body },
    );

    if (waitUrl) {
      await page.goto(
        waitUrl.startsWith('http') ? waitUrl : `${page.url().replace(/\/[^/]*$/, '')}${waitUrl}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 },
      );
    }

    const path = screenshotPath(undefined, session);
    await page.screenshot({ path });
    return { success: true, screenshot: path, data: { method, url, response, navigated: page.url() } };
  }

  // UI form submit via shared action
  await actionSubmit(page, selector ? [selector] : []);

  if (waitUrl) {
    await page.waitForURL(waitUrl.includes('*') ? waitUrl : `**${waitUrl}*`, { timeout: 30000 });
  }

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { selector: selector || 'Enter', url: page.url() } };
});
