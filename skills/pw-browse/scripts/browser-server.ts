// browser-server.ts — Standalone browser server process
// Uses launchServer for stable process management + --remote-debugging-port for CDP.
// CDP enables context/page persistence across reconnections.
//
// Args:
//   --headless          Run headless
//   --user-data-dir=DIR Session-specific profile directory
import { chromium } from 'playwright';
import { createServer } from 'net';

const headless = process.argv.includes('--headless');

// Find a free port for CDP
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

  const server = await chromium.launchServer({
    headless,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
    ],
  });

  const wsEndpoint = server.wsEndpoint();
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

  process.stdout.write(JSON.stringify({ wsEndpoint, cdpEndpoint, pid }) + '\n');

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
})();
