// tab-registry.ts — Stable tab identity management
// Assigns and tracks pw-skill owned tab IDs independent of Playwright page array index.

export interface TabEntry {
  tabId: number;
  url: string;
  title?: string;
  createdAt: string;
}

let nextId = 1;
const registry = new Map<number, TabEntry>();

export function assignTabId(url: string, title?: string): TabEntry {
  const entry: TabEntry = {
    tabId: nextId++,
    url,
    title,
    createdAt: new Date().toISOString(),
  };
  registry.set(entry.tabId, entry);
  return entry;
}

export function removeTab(tabId: number): void {
  registry.delete(tabId);
}

export function getTab(tabId: number): TabEntry | undefined {
  return registry.get(tabId);
}

export function updateTab(tabId: number, updates: Partial<TabEntry>): void {
  const entry = registry.get(tabId);
  if (entry) {
    Object.assign(entry, updates);
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
}
