import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSessionStore } from '../skills/pw-browse/scripts/session.js';
import { analyze } from '../skills/pw-browse/scripts/analyze.js';

// analyze uses the default global store, so we test the function signature
// and basic behavior. For full isolation, analyze would need DI like session/rary.

describe('analyze — result structure', () => {
  it('returns all required categories', () => {
    const result = analyze();
    expect(result).toHaveProperty('live');
    expect(result).toHaveProperty('dead');
    expect(result).toHaveProperty('stale');
    expect(result).toHaveProperty('orphaned');
    expect(result).toHaveProperty('broken');
    expect(Array.isArray(result.live)).toBe(true);
    expect(Array.isArray(result.dead)).toBe(true);
    expect(Array.isArray(result.stale)).toBe(true);
    expect(Array.isArray(result.orphaned)).toBe(true);
    expect(Array.isArray(result.broken)).toBe(true);
  });

  it('items have name field', () => {
    const result = analyze();
    for (const category of [result.live, result.dead, result.stale, result.orphaned, result.broken]) {
      for (const item of category) {
        expect(item).toHaveProperty('name');
      }
    }
  });
});

describe('analyze — dead session detection', () => {
  const TEST_DIR = join(tmpdir(), `pw-analyze-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('detects dead session via session store', () => {
    const store = createSessionStore({
      globalDir: TEST_DIR,
      localDir: join(TEST_DIR, 'local'),
    });
    store.createSession('dead-test', 9999, 99999999); // fake dead PID
    expect(store.isSessionAlive('dead-test')).toBe(false);
  });

  it('detects live session via session store', () => {
    const store = createSessionStore({
      globalDir: TEST_DIR,
      localDir: join(TEST_DIR, 'local'),
    });
    store.createSession('live-test', 9999, process.pid); // own PID = alive
    expect(store.isSessionAlive('live-test')).toBe(true);
  });
});

describe('analyze — stale binding detection', () => {
  const TEST_DIR = join(tmpdir(), `pw-stale-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('detects stale binding via session store', () => {
    const store = createSessionStore({
      globalDir: TEST_DIR,
      localDir: join(TEST_DIR, 'local'),
    });
    store.bindSession('ghost-session');
    const bound = store.getBoundSession();
    expect(bound).toBe('ghost-session');
    // ghost-session doesn't exist → stale
    expect(store.getSession('ghost-session')).toBeNull();
  });
});

describe('clean — cleanDead pattern', () => {
  const TEST_DIR = join(tmpdir(), `pw-clean-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('removes dead session metadata, keeps user-data', () => {
    const store = createSessionStore({
      globalDir: TEST_DIR,
      localDir: join(TEST_DIR, 'local'),
    });
    store.createSession('dead', 9999, 99999999);
    expect(store.getSession('dead')).not.toBeNull();

    // Simulate cleanDead
    store.deleteSession('dead', true);
    expect(store.getSession('dead')).toBeNull();
    expect(store.hasProfile('dead')).toBe(true); // user-data preserved
  });
});

describe('clean — cleanStale pattern', () => {
  const TEST_DIR = join(tmpdir(), `pw-cleanstale-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('unbinds stale session', () => {
    const store = createSessionStore({
      globalDir: TEST_DIR,
      localDir: join(TEST_DIR, 'local'),
    });
    store.bindSession('ghost');
    expect(store.getBoundSession()).toBe('ghost');

    store.unbindSession();
    expect(store.getBoundSession()).toBeNull();
  });
});
