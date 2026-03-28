// browser-server.ts — Standalone browser server process
// Launched as a detached child process, stays alive after parent exits.
// Outputs wsEndpoint to stdout, then keeps running.
//
// Args:
//   --headless          Run headless
//   --user-data-dir=DIR Session-specific profile directory
//
// NOTE: --user-data-dir is passed as a Chromium CLI arg. However, Playwright's
// launchServer() manages its own browser profile internally, which may override
// or ignore the --user-data-dir arg. As a result, user-data-dir alone is NOT a
// reliable mechanism for persisting authentication or session data across restarts.
// The storageState mechanism (saving/loading state.json via BrowserContext) is the
// reliable way to persist cookies, localStorage, and auth across sessions.
import { chromium } from 'playwright';

const headless = process.argv.includes('--headless');
const userDataDir = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);

(async () => {
  const server = await chromium.launchServer({
    headless,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
    ],
  });

  const wsEndpoint = server.wsEndpoint();
  const pid = process.pid;

  process.stdout.write(JSON.stringify({ wsEndpoint, pid }) + '\n');

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
})();
