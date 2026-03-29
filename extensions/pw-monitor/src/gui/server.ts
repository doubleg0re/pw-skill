#!/usr/bin/env npx tsx
// gui/server.ts — Lightweight HTTP server for pw-monitor dashboard
// No external dependencies — uses Node built-in http module.
// Serves dashboard HTML and provides JSON API for monitor state.
//
// Usage: server.ts <sessionName> [--port=3100]

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const sessionName = args.find(a => !a.startsWith('--'));
const portFlag = args.find(a => a.startsWith('--port='));
const port = portFlag ? parseInt(portFlag.slice('--port='.length), 10) : 3100;

if (!sessionName) {
  process.stderr.write('Usage: server.ts <sessionName> [--port=3100]\n');
  process.exit(1);
}

const sessionDir = join(homedir(), '.playwright-state', 'sessions', sessionName);
const registryPath = join(sessionDir, 'monitor-tabs.json');
const sessionJsonPath = join(sessionDir, 'session.json');
const pendingActionsPath = join(sessionDir, 'pending-actions.json');
const dashboardPath = join(import.meta.dirname || __dirname, 'dashboard.html');

function readJsonSafe(path: string): any {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  switch (url.pathname) {
    case '/':
    case '/dashboard': {
      if (!existsSync(dashboardPath)) {
        res.writeHead(404);
        res.end('dashboard.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(dashboardPath, 'utf-8'));
      return;
    }

    case '/api/state': {
      const tabs = readJsonSafe(registryPath);
      const session = readJsonSafe(sessionJsonPath);
      const pendingActions = readJsonSafe(pendingActionsPath);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session: session ? {
          name: session.name,
          id: session.id,
          pid: session.pid,
          cdpEndpoint: session.cdpEndpoint,
          startedAt: session.startedAt,
        } : null,
        tabs: tabs?.tabs || [],
        activeTabId: tabs?.activeTabId ?? null,
        sidecarPid: tabs?.sidecarPid ?? null,
        sidecarAlive: tabs?.sidecarPid ? isAlive(tabs.sidecarPid) : false,
        pendingActions: pendingActions?.pending || [],
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    default:
      res.writeHead(404);
      res.end('Not found');
  }
});

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

server.listen(port, () => {
  process.stderr.write(`[pw-monitor-gui] dashboard at http://localhost:${port}\n`);
  process.stderr.write(`[pw-monitor-gui] session: ${sessionName}\n`);
});
