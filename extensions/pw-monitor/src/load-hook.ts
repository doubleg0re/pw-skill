// load-hook.ts — Per-command tab sync hook
// Runs at the start of every pw command when pw-monitor is active.
// Restores persisted tab registry, syncs against live CDP targets,
// emits change events, and persists updated state.
import { join } from 'path';
import { homedir } from 'os';
import { extractCdpPort, fetchTargets } from './cdp-targets.js';
import { loadStore } from './tab-store.js';
import { syncTabs } from './tab-sync.js';

function getSessionDir(sessionName: string): string {
  return join(homedir(), '.playwright-state', 'sessions', sessionName);
}

export default async (ctx: any) => {
  const port = extractCdpPort(ctx.session?.cdpEndpoint);
  if (!port) {
    ctx.logger.warn('no CDP endpoint available, skipping tab sync');
    return;
  }

  const sessionDir = getSessionDir(ctx.session.name);
  const registryPath = join(sessionDir, 'monitor-tabs.json');

  // 1. Restore store (falls back to empty on failure)
  const store = loadStore(registryPath);

  // 2. Fetch live targets
  let liveTargets;
  try {
    liveTargets = await fetchTargets(port);
  } catch (err: any) {
    ctx.logger.warn(`CDP target fetch failed: ${err.message}, starting clean`);
    store.clear();
    store.save(registryPath);
    return;
  }

  // 3. Sync and collect events
  const events = syncTabs(store, liveTargets, ctx.session.name);

  // 4. Emit events
  for (const evt of events) {
    ctx.emitEvent(evt.event, evt.payload);
  }

  // 5. Persist
  store.save(registryPath);

  // 6. Register cleanup to persist again on exit (captures any mid-command changes)
  ctx.registerCleanup(() => store.save(registryPath));

  ctx.logger.info(`synced ${store.count()} tabs (${events.length} changes)`);
};
