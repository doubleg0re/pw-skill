// tab-sync.test.ts — Unit tests for tab-sync and tab-store
import { describe, it, expect, beforeEach } from 'vitest';
import { loadStore, type TabStore } from '../src/tab-store.js';
import { syncTabs } from '../src/tab-sync.js';
import { extractCdpPort } from '../src/cdp-targets.js';
import type { PageTarget } from '../src/cdp-targets.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pw-monitor-test-'));
}

// --- extractCdpPort ---

describe('extractCdpPort', () => {
  it('extracts port from ws endpoint', () => {
    expect(extractCdpPort('ws://localhost:9222/devtools/browser/abc')).toBe(9222);
  });

  it('extracts port from high port', () => {
    expect(extractCdpPort('ws://127.0.0.1:50072/devtools/browser/xyz')).toBe(50072);
  });

  it('returns null for undefined', () => {
    expect(extractCdpPort(undefined)).toBeNull();
  });

  it('returns null for malformed endpoint', () => {
    expect(extractCdpPort('not-a-url')).toBeNull();
  });
});

// --- TabStore ---

describe('TabStore', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    storePath = join(dir, 'tabs.json');
  });

  it('creates empty store when file does not exist', () => {
    const store = loadStore(storePath);
    expect(store.count()).toBe(0);
    expect(store.all()).toEqual([]);
  });

  it('adds entries with auto-incrementing tabId', () => {
    const store = loadStore(storePath);
    const a = store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    const b = store.add({ cdpTargetId: 'B', url: 'http://b.com', title: 'B' });
    expect(a.tabId).toBe(1);
    expect(b.tabId).toBe(2);
    expect(store.count()).toBe(2);
  });

  it('finds by cdpTargetId', () => {
    const store = loadStore(storePath);
    store.add({ cdpTargetId: 'X', url: 'http://x.com', title: 'X' });
    expect(store.findByCdpId('X')?.url).toBe('http://x.com');
    expect(store.findByCdpId('Z')).toBeUndefined();
  });

  it('finds by URL', () => {
    const store = loadStore(storePath);
    store.add({ cdpTargetId: 'X', url: 'http://x.com', title: 'X' });
    expect(store.findByUrl('http://x.com')?.cdpTargetId).toBe('X');
    expect(store.findByUrl('http://z.com')).toBeUndefined();
  });

  it('persists and restores', () => {
    const store = loadStore(storePath);
    store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    store.add({ cdpTargetId: 'B', url: 'http://b.com', title: 'B' });
    store.save(storePath);

    const restored = loadStore(storePath);
    expect(restored.count()).toBe(2);
    expect(restored.findByCdpId('A')?.tabId).toBe(1);
    expect(restored.findByCdpId('B')?.tabId).toBe(2);
  });

  it('continues nextId after restore', () => {
    const store = loadStore(storePath);
    store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    store.save(storePath);

    const restored = loadStore(storePath);
    const newEntry = restored.add({ cdpTargetId: 'C', url: 'http://c.com', title: 'C' });
    expect(newEntry.tabId).toBe(2); // continues from nextId=2
  });

  it('falls back to empty on corrupted file', () => {
    writeFileSync(storePath, 'NOT JSON', 'utf-8');
    const store = loadStore(storePath);
    expect(store.count()).toBe(0);
  });

  it('removes entries', () => {
    const store = loadStore(storePath);
    const a = store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    store.remove(a.tabId);
    expect(store.count()).toBe(0);
    expect(store.get(a.tabId)).toBeUndefined();
  });

  it('updates entries', () => {
    const store = loadStore(storePath);
    const a = store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    store.update(a.tabId, { url: 'http://a2.com', title: 'A2' });
    expect(store.get(a.tabId)?.url).toBe('http://a2.com');
    expect(store.get(a.tabId)?.title).toBe('A2');
  });

  it('clears all entries and resets nextId', () => {
    const store = loadStore(storePath);
    store.add({ cdpTargetId: 'A', url: 'http://a.com', title: 'A' });
    store.clear();
    expect(store.count()).toBe(0);
    const fresh = store.add({ cdpTargetId: 'B', url: 'http://b.com', title: 'B' });
    expect(fresh.tabId).toBe(1); // reset
  });
});

// --- syncTabs ---

describe('syncTabs', () => {
  let dir: string;
  let storePath: string;
  let store: TabStore;

  beforeEach(() => {
    dir = makeTmpDir();
    storePath = join(dir, 'tabs.json');
    store = loadStore(storePath);
  });

  it('adds new targets as tab:created', () => {
    const targets: PageTarget[] = [
      { cdpTargetId: 'T1', url: 'http://a.com', title: 'A' },
      { cdpTargetId: 'T2', url: 'http://b.com', title: 'B' },
    ];

    const events = syncTabs(store, targets, 'test-session');
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('tab:created');
    expect(events[0].payload.url).toBe('http://a.com');
    expect(events[1].event).toBe('tab:created');
    expect(events[1].payload.url).toBe('http://b.com');
    expect(store.count()).toBe(2);
  });

  it('removes zombie entries as tab:closed', () => {
    store.add({ cdpTargetId: 'OLD', url: 'http://old.com', title: 'Old' });
    const targets: PageTarget[] = []; // nothing live

    const events = syncTabs(store, targets, 'test-session');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('tab:closed');
    expect(events[0].payload.url).toBe('http://old.com');
    expect(store.count()).toBe(0);
  });

  it('detects navigation as tab:navigated', () => {
    store.add({ cdpTargetId: 'T1', url: 'http://a.com', title: 'A' });
    const targets: PageTarget[] = [
      { cdpTargetId: 'T1', url: 'http://a.com/page2', title: 'A Page 2' },
    ];

    const events = syncTabs(store, targets, 'test-session');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('tab:navigated');
    expect(events[0].payload.url).toBe('http://a.com/page2');
    expect(events[0].payload.tabId).toBe(1);
  });

  it('matches by URL fallback when cdpTargetId changes', () => {
    store.add({ cdpTargetId: 'OLD-ID', url: 'http://a.com', title: 'A' });
    const targets: PageTarget[] = [
      { cdpTargetId: 'NEW-ID', url: 'http://a.com', title: 'A' },
    ];

    const events = syncTabs(store, targets, 'test-session');
    // URL match → no close/create, just update cdpTargetId
    expect(events).toHaveLength(0);
    expect(store.findByCdpId('NEW-ID')).toBeDefined();
    expect(store.findByCdpId('OLD-ID')).toBeUndefined();
  });

  it('handles mixed scenario: match + zombie + new', () => {
    store.add({ cdpTargetId: 'KEEP', url: 'http://keep.com', title: 'Keep' });
    store.add({ cdpTargetId: 'GONE', url: 'http://gone.com', title: 'Gone' });
    const targets: PageTarget[] = [
      { cdpTargetId: 'KEEP', url: 'http://keep.com', title: 'Keep' },
      { cdpTargetId: 'FRESH', url: 'http://fresh.com', title: 'Fresh' },
    ];

    const events = syncTabs(store, targets, 'test-session');
    const closed = events.filter(e => e.event === 'tab:closed');
    const created = events.filter(e => e.event === 'tab:created');
    expect(closed).toHaveLength(1);
    expect(closed[0].payload.url).toBe('http://gone.com');
    expect(created).toHaveLength(1);
    expect(created[0].payload.url).toBe('http://fresh.com');
    expect(store.count()).toBe(2);
  });

  it('emits no events when registry matches live targets exactly', () => {
    store.add({ cdpTargetId: 'T1', url: 'http://a.com', title: 'A' });
    const targets: PageTarget[] = [
      { cdpTargetId: 'T1', url: 'http://a.com', title: 'A' },
    ];

    const events = syncTabs(store, targets, 'test-session');
    expect(events).toHaveLength(0);
  });

  it('handles empty store and empty targets', () => {
    const events = syncTabs(store, [], 'test-session');
    expect(events).toHaveLength(0);
    expect(store.count()).toBe(0);
  });

  it('preserves tabId stability across syncs', () => {
    store.add({ cdpTargetId: 'T1', url: 'http://a.com', title: 'A' });
    store.save(storePath);

    // Restore and sync
    const restored = loadStore(storePath);
    const targets: PageTarget[] = [
      { cdpTargetId: 'T1', url: 'http://a.com/updated', title: 'A Updated' },
    ];
    const events = syncTabs(restored, targets, 'test-session');
    expect(events[0].payload.tabId).toBe(1); // same tabId
    expect(restored.get(1)?.url).toBe('http://a.com/updated');
  });

  it('sets canonical event payload shape', () => {
    const targets: PageTarget[] = [
      { cdpTargetId: 'T1', url: 'http://a.com', title: 'A' },
    ];
    const events = syncTabs(store, targets, 'my-session');
    const payload = events[0].payload;
    expect(payload).toHaveProperty('event', 'tab:created');
    expect(payload).toHaveProperty('session', 'my-session');
    expect(payload).toHaveProperty('tabId');
    expect(payload).toHaveProperty('url');
    expect(payload).toHaveProperty('title');
    expect(payload).toHaveProperty('timestamp');
  });
});
