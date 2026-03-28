// browser-server.ts — Standalone browser server process
// Launched as a detached child process, stays alive after parent exits.
// Outputs wsEndpoint to stdout, then keeps running.
import { chromium } from 'playwright';

const headless = process.argv.includes('--headless');

(async () => {
  const server = await chromium.launchServer({
    headless,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const wsEndpoint = server.wsEndpoint();
  const pid = process.pid;

  // Output JSON to stdout for parent to read
  process.stdout.write(JSON.stringify({ wsEndpoint, pid }) + '\n');

  // Keep alive — server runs until killed
  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
})();
