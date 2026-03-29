// close-hook.ts — Session close cleanup
// Kills sidecar process if running, preserves registry for recovery.
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

function getSessionDir(sessionName: string): string {
  return join(homedir(), '.playwright-state', 'sessions', sessionName);
}

export default async (ctx: any) => {
  const sessionName = ctx.session?.name;
  if (!sessionName) return;

  const registryPath = join(getSessionDir(sessionName), 'monitor-tabs.json');

  // Kill sidecar if alive
  if (existsSync(registryPath)) {
    try {
      const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
      if (data.sidecarPid) {
        process.kill(data.sidecarPid, 'SIGTERM');
        ctx.logger.info(`sidecar killed (pid=${data.sidecarPid})`);
      }
    } catch {}
  }

  ctx.logger.info('session closing, monitor state preserved for recovery');
};
