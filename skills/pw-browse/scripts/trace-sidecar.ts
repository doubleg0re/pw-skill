#!/usr/bin/env npx tsx
// trace-sidecar.ts — Keeps a Playwright trace alive across pw reconnects.
//
// Usage:
//   trace-sidecar.ts --session=<name> --state-file=<path> --stop-file=<path> --result-file=<path> [--screenshots] [--snapshots]

import { chromium } from 'playwright';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { getSession } from './session.js';

const args = process.argv.slice(2);

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const sessionName = parseFlag('session');
const stateFile = parseFlag('state-file');
const stopFile = parseFlag('stop-file');
const resultFile = parseFlag('result-file');
const screenshots = hasFlag('screenshots');
const snapshots = hasFlag('snapshots');

if (!sessionName || !stateFile || !stopFile || !resultFile) {
  process.stderr.write('Usage: trace-sidecar.ts --session=<name> --state-file=<path> --stop-file=<path> --result-file=<path> [--screenshots] [--snapshots]\n');
  process.exit(1);
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function removeFile(file: string): void {
  try { unlinkSync(file); } catch {}
}

let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
let stopping = false;

async function shutdown(err?: string): Promise<never> {
  removeFile(stateFile);
  if (err) writeJson(resultFile, { success: false, error: err });
  process.exit(err ? 1 : 0);
}

async function main(): Promise<void> {
  const session = getSession(sessionName);
  if (!session) {
    await shutdown(`Session "${sessionName}" not found.`);
  }

  if (!session.cdpEndpoint && !session.wsEndpoint) {
    await shutdown(`Session "${sessionName}" has no reconnectable browser endpoint.`);
  }

  browser = session.cdpEndpoint
    ? await chromium.connectOverCDP(session.cdpEndpoint).catch(() => session.wsEndpoint ? chromium.connect(session.wsEndpoint) : Promise.reject(new Error('CDP connect failed')))
    : await chromium.connect(session.wsEndpoint);

  const context = browser.contexts()[0];
  if (!context) {
    await shutdown(`Session "${sessionName}" has no browser context to trace.`);
  }

  await context.tracing.start({
    screenshots,
    snapshots,
    sources: false,
  });

  writeJson(stateFile, {
    pid: process.pid,
    session: sessionName,
    startedAt: new Date().toISOString(),
    screenshots,
    snapshots,
  });

  setInterval(async () => {
    if (stopping || !existsSync(stopFile)) return;
    stopping = true;

    try {
      const request = JSON.parse(readFileSync(stopFile, 'utf-8')) as { path?: string };
      removeFile(stopFile);
      if (!request.path) {
        await shutdown('Trace stop request missing output path.');
      }

      await context.tracing.stop({ path: request.path });
      writeJson(resultFile, {
        success: true,
        file: request.path,
        stoppedAt: new Date().toISOString(),
      });
      removeFile(stateFile);
      process.exit(0);
    } catch (err) {
      await shutdown(err instanceof Error ? err.message : String(err));
    }
  }, 200);
}

process.on('SIGTERM', () => {
  void shutdown();
});

process.on('SIGINT', () => {
  void shutdown();
});

void main().catch(err => {
  void shutdown(err instanceof Error ? err.message : String(err));
});
