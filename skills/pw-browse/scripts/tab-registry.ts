// tab-registry.ts — Stable tab identity management
// Assigns and tracks pw-skill owned tab IDs independent of Playwright page array index.
// Persists to session-scoped tabs.json for recovery across restarts.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from './file-utils.js';

export interface TabEntry {
  tabId: number;
  url: string;
  title?: string;
  createdAt: string;
}

/** Canonical tab event payload — all tab:* events must use this shape */
export interface TabEventPayload {
  event: string;
  session: string;
  tabId: number;
  url: string;
  title?: string;
  timestamp: string;
}

let nextId = 1;
const registry = new Map<number, TabEntry>();
let persistPath: string | null = null;

export function assignTabId(url: string, title?: string): TabEntry {
  const entry: TabEntry = {
    tabId: nextId++,
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
