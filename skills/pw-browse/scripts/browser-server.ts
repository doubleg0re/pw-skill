// browser-server.ts — Standalone browser server process (detached)
// Uses launchPersistentContext for real Chrome profile persistence.
// CDP port opened separately for context/page reconnection.
//
// Args:
//   --headless            Run headless
//   --user-data-dir=DIR   Session-specific Chrome profile directory
import { chromium } from 'playwright';
import { createServer } from 'net';

const headless = process.argv.includes('--headless');
const userDataDir = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) || '';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

(async () => {
  const cdpPort = await findFreePort();

  // launchPersistentContext: userDataDir is the FIRST parameter (not a Chrome arg)
  // This gives us a real persistent Chrome profile that survives restarts
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
    ],
  });

  const pid = process.pid;

  // Wait for CDP to be ready
  let cdpEndpoint = '';
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${cdpPort}/json/version`, { signal: AbortSignal.timeout(500) });
      const json = await res.json();
      if (json.webSocketDebuggerUrl) {
        cdpEndpoint = json.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  process.stdout.write(JSON.stringify({ cdpEndpoint, pid }) + '\n');

  process.on('SIGTERM', async () => {
    await context.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await context.close();
    process.exit(0);
  });
})();
