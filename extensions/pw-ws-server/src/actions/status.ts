// ws-server-status — Check WebSocket server status
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

  const metadataPath = join(sessionDir(sessionName), 'ws-server.json');

  if (!existsSync(metadataPath)) {
    return { result: { running: false, session: sessionName } };
  }

  try {
    const meta = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    const running = meta.pid ? isAlive(meta.pid) : false;
    return {
      result: {
        ...meta,
        running,
        url: `ws://${meta.host}:${meta.port}`,
      },
    };
  } catch {
    return { result: { running: false, session: sessionName, error: 'Corrupted metadata' } };
  }
}
