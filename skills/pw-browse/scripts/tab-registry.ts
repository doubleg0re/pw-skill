// tab-registry.ts — Stable tab identity management
// Assigns and tracks pw-skill owned tab IDs independent of Playwright page array index.
// Persists to session-scoped tabs.json for recovery across restarts.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from './file-utils.js';

export interface TabEntry {
  tabId: number;
  pageIndex?: number; // Playwright page array index at creation time
  /** Chrome DevTools target id — the only handle that survives reorder and navigation. */
  targetId?: string;
  url: string;
  title?: string;
  createdAt: string;
}

// --- Core tab event contract ---
// These are the standard runtime event names. Both core and extensions
// may emit them, but they must follow the same payload contract.
// Extensions emitting tab:* are supplementing core, not replacing it.

export const TAB_EVENTS = {
  CREATED: 'tab:created',
  CLOSED: 'tab:closed',
  NAVIGATED: 'tab:navigated',
  ACTIVATED: 'tab:activated',
  DEACTIVATED: 'tab:deactivated',
} as const;

export type TabEventName = (typeof TAB_EVENTS)[keyof typeof TAB_EVENTS];

/** Canonical tab event payload — all tab:* events must use this shape */
export interface TabEventPayload {
  event: TabEventName;
  session: string;
  tabId: number;
  url: string;
  title?: string;
  timestamp: string;
}

/** Required fields for TabEventPayload validation */
export const TAB_EVENT_REQUIRED_FIELDS = ['event', 'session', 'tabId', 'url', 'timestamp'] as const;

let nextId = 1;
const registry = new Map<number, TabEntry>();
let persistPath: string | null = null;

export function assignTabId(url: string, title?: string, pageIndex?: number, targetId?: string): TabEntry {
  const entry: TabEntry = {
    tabId: nextId++,
    pageIndex,
    targetId,
    url,
    title,
    createdAt: new Date().toISOString(),
  };
  registry.set(entry.tabId, entry);
  persist();
  return entry;
}

export function removeTab(tabId: number): void {
  registry.delete(tabId);
  persist();
}

export function getTab(tabId: number): TabEntry | undefined {
  return registry.get(tabId);
}

export function updateTab(tabId: number, updates: Partial<TabEntry>): void {
  const entry = registry.get(tabId);
  if (entry) {
    Object.assign(entry, updates);
    persist();
  }
}

export function listTabs(): TabEntry[] {
  return Array.from(registry.values());
}

export function findTabByUrl(url: string): TabEntry | undefined {
  for (const entry of registry.values()) {
    if (entry.url === url) return entry;
  }
  return undefined;
}

export function findTabByTargetId(targetId: string): TabEntry | undefined {
  for (const entry of registry.values()) {
    if (entry.targetId === targetId) return entry;
  }
  return undefined;
}

/** A resolved tab target, or the reason it could not be resolved. */
export interface TabResolution {
  index?: number;
  error?: string;
}

/**
 * Resolve `--tab=N` against the live page list.
 *
 * An out-of-range index used to be dropped, leaving the command pointed at the
 * default page — so a stale index quietly wrote into tab 0.
 */
export function resolveTabIndexFlag(raw: string, pageCount: number): TabResolution {
  const index = Number(raw);
  if (!/^\d+$/.test(raw.trim())) {
    return { error: `Invalid --tab=${raw}. Expected a tab index; run \`pw tab list\` to see the open tabs.` };
  }
  if (pageCount === 0) {
    return { error: `--tab=${raw} cannot be used: no tabs are open in this session.` };
  }
  if (index >= pageCount) {
    return {
      error:
        `--tab=${raw} is out of range: ${pageCount} tab${pageCount === 1 ? '' : 's'} open (0-${pageCount - 1}). ` +
        `Tab indices shift when tabs open or close — use \`pw tab list\` and --tab-id=<id> for a handle that does not move.`,
    };
  }
  return { index };
}

/**
 * Resolve `--tab-id=N` to a live page position by matching the recorded
 * DevTools target id. Unlike an index it survives reordering, and unlike a URL
 * it survives navigation.
 */
export function resolveTabIdFlag(raw: string, liveTargetIds: Array<string | undefined>): TabResolution {
  if (!/^\d+$/.test(raw.trim())) {
    return { error: `Invalid --tab-id=${raw}. Expected a numeric tab id from \`pw tab list\`.` };
  }
  const entry = getTab(Number(raw));
  if (!entry) {
    return { error: `--tab-id=${raw} is not a known tab in this session. Run \`pw tab list\` for current ids.` };
  }
  if (!entry.targetId) {
    return { error: `--tab-id=${raw} has no target id recorded. Run \`pw tab list\` to re-register the open tabs.` };
  }
  const index = liveTargetIds.indexOf(entry.targetId);
  if (index < 0) {
    return { error: `--tab-id=${raw} is no longer open (last seen at ${entry.url}).` };
  }
  return { index };
}

export function findTabByPageIndex(pageIndex: number): TabEntry | undefined {
  for (const entry of registry.values()) {
    if (entry.pageIndex === pageIndex) return entry;
  }
  return undefined;
}

export function resolveTab(url: string | undefined, pageIndex?: number): TabEntry | undefined {
  const byUrl = url ? findTabByUrl(url) : undefined;
  if (byUrl) {
    if (pageIndex !== undefined && byUrl.pageIndex !== pageIndex) {
      updateTab(byUrl.tabId, { pageIndex });
    }
    return byUrl;
  }

  if (pageIndex === undefined) return undefined;
  return findTabByPageIndex(pageIndex);
}

export function clearRegistry(): void {
  registry.clear();
  nextId = 1;
  persist();
}

/** Build canonical tab event payload */
export function buildTabEvent(event: string, sessionName: string, entry: TabEntry): TabEventPayload {
  return {
    event,
    session: sessionName,
    tabId: entry.tabId,
    url: entry.url,
    title: entry.title,
    timestamp: new Date().toISOString(),
  };
}

// --- Persistence ---

/** Set the path for tab registry persistence (session-scoped) */
export function setPersistPath(path: string): void {
  persistPath = path;
}

/** Persist current registry to tabs.json */
function persist(): void {
  if (!persistPath) return;
  try {
    atomicWriteJSON(persistPath, { nextId, tabs: Array.from(registry.entries()) });
  } catch {}
}

/** Restore registry from tabs.json */
export function restoreRegistry(path: string): void {
  persistPath = path;
  if (!existsSync(path)) return;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (data.nextId) nextId = data.nextId;
    if (Array.isArray(data.tabs)) {
      registry.clear();
      for (const [id, entry] of data.tabs) {
        registry.set(id, entry);
      }
    }
  } catch {}
}
