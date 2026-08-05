// browser-server.ts — Standalone browser server process (detached)
// Uses launchPersistentContext for real Chrome profile persistence.
// CDP port opened separately for context/page reconnection.
//
// Args:
//   --headless              Run headless
//   --user-data-dir=DIR     Session-specific Chrome profile directory
//   --device=NAME           Playwright device preset to emulate (e.g. "iPhone 12")
//   --device-viewport=WxH   Override the device preset's viewport
import { chromium, type BrowserContextOptions } from 'playwright';
import { createServer } from 'net';
import { buildChromiumArgs } from './browser-args.js';
import { resolveDevicePreset, buildDeviceContextOptions, isDevicePresetDisabled } from './device-presets.js';

const headless = process.argv.includes('--headless');
const userDataDir = process.argv.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) || '';
const deviceName = process.argv.find(a => a.startsWith('--device='))?.slice('--device='.length);
const deviceViewport = process.argv.find(a => a.startsWith('--device-viewport='))?.slice('--device-viewport='.length);
// Drive a real Chromium-family browser instead of the bundled one (see browser-resolve.ts).
const executablePath = process.argv.find(a => a.startsWith('--executable='))?.slice('--executable='.length);
const channel = process.argv.find(a => a.startsWith('--channel='))?.slice('--channel='.length);
// Hide the automation fingerprint (navigator.webdriver) that trips anti-bot sign-in blocks.
const stealth = process.argv.includes('--stealth');

function parseViewport(spec?: string): { width: number; height: number } | undefined {
  if (!spec) return undefined;
  const [w, h] = spec.split('x').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : undefined;
}

// Device emulation is applied at context creation (native Playwright) so it
// persists for every CDP-connected command — runtime CDP overrides do not
// survive the session detach, hence --device is fixed at launch.
function deviceContextOptions(): BrowserContextOptions {
  if (!deviceName || isDevicePresetDisabled(deviceName)) return { viewport: null };
  const preset = resolveDevicePreset(deviceName);
  return buildDeviceContextOptions(preset, parseViewport(deviceViewport));
}

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

  let deviceOptions: BrowserContextOptions;
  try {
    deviceOptions = deviceContextOptions();
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + '\n');
    process.exit(1);
  }

  // launchPersistentContext: userDataDir is the FIRST parameter (not a Chrome arg)
  // This gives us a real persistent Chrome profile that survives restarts
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
    ...deviceOptions,
    args: [
      ...buildChromiumArgs(headless, cdpPort),
      ...(stealth ? ['--disable-blink-features=AutomationControlled'] : []),
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
