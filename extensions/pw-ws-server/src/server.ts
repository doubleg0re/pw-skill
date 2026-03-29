#!/usr/bin/env npx tsx
// server.ts — WebSocket server process for pw-ws-server
// Spawned as detached child by ws-server-start action.
//
// Usage: server.ts <sessionName> [--port=47831] [--host=127.0.0.1]
//
// Provides:
// - snapshot on connect
// - live state push via fs.watch
// - bidirectional: client can send action messages

import { WebSocketServer, WebSocket } from 'ws';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pwMonitorAdapter } from './sources/pw-monitor.js';

const args = process.argv.slice(2);
const sessionName = args.find(a => !a.startsWith('--'));
const portFlag = args.find(a => a.startsWith('--port='));
const hostFlag = args.find(a => a.startsWith('--host='));
const port = portFlag ? parseInt(portFlag.slice('--port='.length), 10) : 47831;
const host = hostFlag ? hostFlag.slice('--host='.length) : '127.0.0.1';

if (!sessionName) {
  process.stderr.write('Usage: server.ts <sessionName> [--port=47831] [--host=127.0.0.1]\n');
  process.exit(1);
}

const sessionDir = join(homedir(), '.playwright-state', 'sessions', sessionName);
const metadataPath = join(sessionDir, 'ws-server.json');
const source = pwMonitorAdapter;

// --- WebSocket server ---

const wss = new WebSocketServer({ port, host });

wss.on('listening', () => {
  // Write metadata
  const metadata = {
    pid: process.pid,
    session: sessionName,
    source: source.name,
    host,
    port,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  process.stderr.write(`[pw-ws-server] listening on ws://${host}:${port}\n`);
  process.stderr.write(`[pw-ws-server] session: ${sessionName}, source: ${source.name}\n`);
});

wss.on('connection', (ws: WebSocket) => {
  // Send snapshot immediately
  const snapshot = source.readSnapshot(sessionName);
  ws.send(JSON.stringify({
    type: 'snapshot',
    source: source.name,
    session: sessionName,
    data: snapshot,
    timestamp: new Date().toISOString(),
  }));

  // Handle incoming messages (bidirectional)
  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleClientMessage(msg, ws);
    } catch {}
  });
});

// Subscribe to source changes and broadcast
const unsubscribe = source.subscribe(sessionName, (snapshot) => {
  const msg = JSON.stringify({
    type: 'event',
    source: source.name,
    session: sessionName,
    data: snapshot,
    timestamp: new Date().toISOString(),
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
});

// --- Bidirectional: handle client actions ---

async function handleClientMessage(msg: any, ws: WebSocket): Promise<void> {
  if (msg.type !== 'action') return;

  const { action, tabId, data } = msg;

  switch (action) {
    case 'user-action:click': {
      // Resolve pending action and click the button on the page
      // This requires CDP access — use the session's CDP endpoint
      try {
        const sessionJson = existsSync(join(sessionDir, 'session.json'))
          ? JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'))
          : null;

        if (!sessionJson?.cdpEndpoint) {
          ws.send(JSON.stringify({ type: 'error', error: 'No CDP endpoint available' }));
          return;
        }

        const cdpPort = sessionJson.cdpEndpoint.match(/:(\d+)\//)?.[1];
        if (!cdpPort) {
          ws.send(JSON.stringify({ type: 'error', error: 'Cannot extract CDP port' }));
          return;
        }

        // Find target page by tab's cdpTargetId
        const monitorTabs = existsSync(join(sessionDir, 'monitor-tabs.json'))
          ? JSON.parse(readFileSync(join(sessionDir, 'monitor-tabs.json'), 'utf-8'))
          : null;

        const tab = monitorTabs?.tabs?.find((t: any) => t.tabId === tabId);
        if (!tab) {
          ws.send(JSON.stringify({ type: 'error', error: `Tab ${tabId} not found` }));
          return;
        }

        // Use CDP to evaluate click on the overlay button
        const targetWsUrl = `ws://${host}:${cdpPort}/devtools/page/${tab.cdpTargetId}`;
        const cdpWs = new WebSocket(targetWsUrl);

        cdpWs.on('open', () => {
          const buttonAction = data?.action || 'continue';
          cdpWs.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression: `
                const btn = document.querySelector('.__pw_action_btn[data-action="${buttonAction}"]');
                if (btn) { btn.click(); 'clicked'; } else { 'not found'; }
              `,
            },
          }));
        });

        cdpWs.on('message', (raw: Buffer) => {
          try {
            const resp = JSON.parse(raw.toString());
            if (resp.id === 1) {
              const result = resp.result?.result?.value || 'unknown';
              ws.send(JSON.stringify({
                type: 'action-result',
                action: 'user-action:click',
                tabId,
                result,
              }));
              cdpWs.close();
            }
          } catch {}
        });

        cdpWs.on('error', () => {
          ws.send(JSON.stringify({ type: 'error', error: `CDP connection failed for tab ${tabId}` }));
        });
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', error: `Unknown action: ${action}` }));
  }
}

// --- Session liveness check ---

const sessionCheck = setInterval(() => {
  const sessionJson = existsSync(join(sessionDir, 'session.json'))
    ? JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'))
    : null;

  if (!sessionJson) {
    process.stderr.write('[pw-ws-server] session gone, shutting down\n');
    shutdown();
  } else if (sessionJson.pid) {
    try { process.kill(sessionJson.pid, 0); } catch {
      process.stderr.write('[pw-ws-server] session process dead, shutting down\n');
      shutdown();
    }
  }
}, 3000);

function shutdown(): void {
  clearInterval(sessionCheck);
  unsubscribe();
  wss.close();
  try { const { unlinkSync } = require('fs'); unlinkSync(metadataPath); } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

wss.on('error', (err: Error) => {
  if ((err as any).code === 'EADDRINUSE') {
    process.stderr.write(`[pw-ws-server] port ${port} already in use\n`);
    process.exit(1);
  }
});
