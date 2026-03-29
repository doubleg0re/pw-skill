// ws-server-stop — Stop WebSocket server for session
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, unlinkSync } from 'fs';

function sessionDir(sessionName: string): string {
  return join(homedir(), '.playwright-state', 'sessions', sessionName);
}

export default async function(page: any, args: any, runtime?: any): Promise<{ result?: any }> {
  const sessionName = args?.session || runtime?.session?.name;
  if (!sessionName) return { result: { error: 'No active session' } };

  const metadataPath = join(sessionDir(sessionName), 'ws-server.json');

  if (!existsSync(metadataPath)) {
    return { result: { stopped: true, message: 'No WS server running' } };
  }

  try {
    const meta = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    if (meta.pid) {
      try { process.kill(meta.pid, 'SIGTERM'); } catch {}
    }
    try { unlinkSync(metadataPath); } catch {}
    return { result: { stopped: true, pid: meta.pid } };
  } catch {
    return { result: { stopped: true, message: 'Cleaned stale metadata' } };
  }
}
