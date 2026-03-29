// ws-server-start — Start WebSocket server for session
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

function sessionDir(sessionName: string): string {
  return join(homedir(), '.playwright-state', 'sessions', sessionName);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export default async function(page: any, args: any, runtime?: any): Promise<{ result?: any }> {
  const sessionName = runtime?.session?.name;
  if (!sessionName) return { result: { error: 'No active session' } };

  const dir = sessionDir(sessionName);
  const metadataPath = join(dir, 'ws-server.json');
  const port = args?.port || args?.[0] || 47831;
  const host = args?.host || '127.0.0.1';
  const protocol = args?.protocol || 'monitor';
  const replace = args?.replace || false;

  // Check existing server
  if (existsSync(metadataPath)) {
    try {
      const meta = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      if (meta.pid && isAlive(meta.pid)) {
        if (!replace) {
          return { result: { error: `WS server already running (pid=${meta.pid}, port=${meta.port}). Use replace to restart.` } };
        }
        // Kill existing
        try { process.kill(meta.pid, 'SIGTERM'); } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
    } catch {}
  }

  // Spawn server
  const serverScript = join(import.meta.dirname || __dirname, '..', 'server.ts');
  const child = spawn(
    process.execPath,
    [...process.execArgv, serverScript, sessionName, `--port=${port}`, `--host=${host}`, `--protocol=${protocol}`],
    { detached: true, stdio: 'ignore', cwd: process.cwd() },
  );
  child.unref();

  // Wait briefly for server to start and write metadata
  await new Promise(r => setTimeout(r, 1000));

  return {
    result: {
      started: true,
      pid: child.pid,
      url: `ws://${host}:${port}`,
      protocol,
      session: sessionName,
    },
  };
}
