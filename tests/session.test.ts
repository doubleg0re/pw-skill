import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSessionStore,
  generateSessionId,
  isProcessAlive,
  type SessionStore,
} from '../skills/pw-browse/scripts/session.js';

const TEST_GLOBAL = join(tmpdir(), `pw-test-global-${Date.now()}`);
const TEST_LOCAL = join(tmpdir(), `pw-test-local-${Date.now()}`);

let store: SessionStore;

function setup() {
  store = createSessionStore({ globalDir: TEST_GLOBAL, localDir: TEST_LOCAL });
}

function cleanup() {
  if (existsSync(TEST_GLOBAL)) rmSync(TEST_GLOBAL, { recursive: true, force: true });
  if (existsSync(TEST_LOCAL)) rmSync(TEST_LOCAL, { recursive: true, force: true });
}

// --- Pure functions ---

describe('generateSessionId', () => {
  it('generates 8 char hex string', () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe('isProcessAlive', () => {
  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for non-existent PID', () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });
});

// --- CRUD ---

describe('SessionStore — createSession / getSession', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates and retrieves a session', () => {
    const session = store.createSession('dev', 9222, 12345);
    expect(session.name).toBe('dev');
    expect(session.port).toBe(9222);
    expect(session.pid).toBe(12345);
    expect(session.id).toMatch(/^[0-9a-f]{8}$/);
    expect(session.startedAt).toBeTruthy();
    expect(session.video).toBeNull();

    const retrieved = store.getSession('dev');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('dev');
    expect(retrieved!.port).toBe(9222);
  });

  it('creates session with video', () => {
    const session = store.createSession('rec', 9333, 111, 'ws://localhost:9333/fake', 'my-video');
    expect(session.video).toBe('my-video');
    expect(session.wsEndpoint).toBe('ws://localhost:9333/fake');
  });

  it('stores screenshot directory when provided', () => {
    const session = store.createSession('shots', 9333, 111, 'ws://localhost:9333/fake', null, '/tmp/pw-shots');
    expect(session.screenshotDir).toBe('/tmp/pw-shots');

    const retrieved = store.getSession('shots');
    expect(retrieved!.screenshotDir).toBe('/tmp/pw-shots');
  });

  it('returns null for missing session', () => {
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('creates user-data directory', () => {
    store.createSession('dev', 9222, 12345);
    expect(existsSync(join(TEST_GLOBAL, 'sessions', 'dev', 'user-data'))).toBe(true);
  });
});

describe('SessionStore — updateSession', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('updates specific fields', () => {
    store.createSession('dev', 9222, 12345);
    store.updateSession('dev', { port: 9999 });
    const updated = store.getSession('dev');
    expect(updated!.port).toBe(9999);
    expect(updated!.pid).toBe(12345); // unchanged
  });
});

describe('SessionStore — deleteSession', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('keeps user-data when keepProfile=true', () => {
    store.createSession('dev', 9222, 12345);
    store.deleteSession('dev', true);
    expect(store.getSession('dev')).toBeNull();
    expect(existsSync(join(TEST_GLOBAL, 'sessions', 'dev', 'user-data'))).toBe(true);
  });

  it('removes everything when keepProfile=false', () => {
    store.createSession('temp', 9222, 12345);
    store.deleteSession('temp', false);
    expect(existsSync(join(TEST_GLOBAL, 'sessions', 'temp'))).toBe(false);
  });
});

describe('SessionStore — listSessions', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('lists all sessions', () => {
    store.createSession('dev', 9001, 1);
    store.createSession('staging', 9002, 2);
    store.createSession('prod', 9003, 3);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(3);
    expect(sessions.map(s => s.name).sort()).toEqual(['dev', 'prod', 'staging']);
  });

  it('returns empty array when no sessions', () => {
    expect(store.listSessions()).toEqual([]);
  });

  it('excludes deleted sessions', () => {
    store.createSession('a', 9001, 1);
    store.createSession('b', 9002, 2);
    store.deleteSession('a', true);
    expect(store.listSessions()).toHaveLength(1);
    expect(store.listSessions()[0].name).toBe('b');
  });
});

// --- Liveness ---

describe('SessionStore — liveness', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('isSessionAlive returns true for alive process', () => {
    store.createSession('alive', 9222, process.pid);
    expect(store.isSessionAlive('alive')).toBe(true);
  });

  it('isSessionAlive returns false for dead process', () => {
    store.createSession('dead', 9222, 99999999);
    expect(store.isSessionAlive('dead')).toBe(false);
  });

  it('cleanupDeadSessions removes dead ones', () => {
    store.createSession('alive', 9001, process.pid);
    store.createSession('dead1', 9002, 99999998);
    store.createSession('dead2', 9003, 99999999);

    const cleaned = store.cleanupDeadSessions();
    expect(cleaned.sort()).toEqual(['dead1', 'dead2']);
    expect(store.listSessions()).toHaveLength(1);
    expect(store.listSessions()[0].name).toBe('alive');
  });

  it('cleanupDeadSessions keeps user-data for resume', () => {
    store.createSession('dead', 9222, 99999999);
    store.cleanupDeadSessions();
    expect(existsSync(join(TEST_GLOBAL, 'sessions', 'dead', 'user-data'))).toBe(true);
  });
});

// --- Binding ---

describe('SessionStore — binding', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('bind and get bound session', () => {
    store.bindSession('dev');
    expect(store.getBoundSession()).toBe('dev');
  });

  it('returns null when not bound', () => {
    expect(store.getBoundSession()).toBeNull();
  });

  it('unbind clears binding', () => {
    store.bindSession('dev');
    store.unbindSession();
    expect(store.getBoundSession()).toBeNull();
  });

  it('rebind overwrites previous', () => {
    store.bindSession('dev');
    store.bindSession('staging');
    expect(store.getBoundSession()).toBe('staging');
  });
});

// --- Resolution ---

describe('SessionStore — resolveSession', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('resolves explicit session by name', () => {
    store.createSession('dev', 9222, process.pid);
    const resolved = store.resolveSession('dev');
    expect(resolved.name).toBe('dev');
  });

  it('throws for missing explicit session', () => {
    expect(() => store.resolveSession('ghost')).toThrow('not found');
  });

  it('throws for dead explicit session', () => {
    store.createSession('dead', 9222, 99999999);
    expect(() => store.resolveSession('dead')).toThrow('not running');
  });

  it('resolves bound session', () => {
    store.createSession('dev', 9222, process.pid);
    store.bindSession('dev');
    const resolved = store.resolveSession();
    expect(resolved.name).toBe('dev');
  });

  it('auto-selects when only one alive session', () => {
    store.createSession('only', 9222, process.pid);
    const resolved = store.resolveSession();
    expect(resolved.name).toBe('only');
    // resolveSession() is pure — does not auto-bind
    expect(store.getBoundSession()).toBeNull();
  });

  it('throws when no sessions', () => {
    expect(() => store.resolveSession()).toThrow('No active sessions');
  });

  it('throws when multiple alive sessions without binding', () => {
    store.createSession('a', 9001, process.pid);
    store.createSession('b', 9002, process.pid);
    expect(() => store.resolveSession()).toThrow('Multiple active sessions');
  });

  it('falls through dead bound session to auto-select', () => {
    store.createSession('dead', 9001, 99999999);
    store.createSession('alive', 9002, process.pid);
    store.bindSession('dead');
    const resolved = store.resolveSession();
    expect(resolved.name).toBe('alive');
    // resolveSession() is pure — stale binding is not overwritten
    expect(store.getBoundSession()).toBe('dead');
  });

  it('returns warning when auto-binding the only live session', () => {
    store.createSession('only', 9222, process.pid);
    const resolved = store.resolveSessionWithContext();
    expect(resolved.session.name).toBe('only');
    expect(resolved.warnings).toEqual(['No session was bound for this cwd. Auto-bound "only".']);
  });

  it('returns warning when recovering from a stale bound session', () => {
    store.createSession('dead', 9001, 99999999);
    store.createSession('alive', 9002, process.pid);
    store.bindSession('dead');
    const resolved = store.resolveSessionWithContext();
    expect(resolved.session.name).toBe('alive');
    expect(resolved.warnings).toEqual(['Bound session "dead" was unavailable. Auto-bound "alive".']);
  });
});

// gitea #7 — a bare command auto-attached to the single live session even when
// it was launched from another working directory, driving its tab under the
// user. Sessions live in the shared global dir, so cwd is the only thing that
// scopes "mine".
describe('SessionStore — cross-cwd auto-select', () => {
  const GLOBAL = join(tmpdir(), `pw-xcwd-global-${Date.now()}`);
  const DIR_A = join(tmpdir(), `pw-xcwd-a-${Date.now()}`);
  const DIR_B = join(tmpdir(), `pw-xcwd-b-${Date.now()}`);
  let storeA: SessionStore;
  let storeB: SessionStore;

  beforeEach(() => {
    storeA = createSessionStore({ globalDir: GLOBAL, localDir: DIR_A });
    storeB = createSessionStore({ globalDir: GLOBAL, localDir: DIR_B });
  });
  afterEach(() => {
    for (const d of [GLOBAL, DIR_A, DIR_B]) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
  });

  it('stamps the launch cwd on the session record', () => {
    const s = storeA.createSession('a', 9001, process.pid);
    expect(s.originDir).toBe(DIR_A);
  });

  it('refuses to auto-select a session launched from another cwd', () => {
    storeA.createSession('remote', 9001, process.pid);
    expect(() => storeB.resolveSessionWithContext()).toThrow(/launched from this directory/);
  });

  it('does not auto-bind a foreign-cwd session', () => {
    storeA.createSession('remote', 9001, process.pid);
    expect(() => storeB.resolveSessionWithContext()).toThrow();
    expect(storeB.getBoundSession()).toBeNull();
  });

  it('names the foreign sessions so the caller can pick one', () => {
    storeA.createSession('remote', 9001, process.pid);
    expect(() => storeB.resolveSessionWithContext()).toThrow(/remote/);
  });

  it('auto-selects the local session even when another cwd also has one', () => {
    storeA.createSession('a', 9001, process.pid);
    storeB.createSession('b', 9002, process.pid);
    const resolved = storeB.resolveSessionWithContext();
    expect(resolved.session.name).toBe('b');
  });

  it('still honors an explicit --session across cwds', () => {
    storeA.createSession('remote', 9001, process.pid);
    expect(storeB.resolveSessionWithContext('remote').session.name).toBe('remote');
  });

  it('resolveSession (pure) also refuses a foreign-cwd auto-select', () => {
    storeA.createSession('remote', 9001, process.pid);
    expect(() => storeB.resolveSession()).toThrow(/launched from this directory/);
  });
});

// --- Profile ---

describe('SessionStore — profile', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('sessionUserDataDir creates and returns path', () => {
    const dir = store.sessionUserDataDir('dev');
    expect(dir).toContain('dev');
    expect(existsSync(dir)).toBe(true);
  });

  it('hasProfile after session creation', () => {
    store.createSession('dev', 9222, 12345);
    expect(store.hasProfile('dev')).toBe(true);
  });

  it('hasProfile survives session delete with keepProfile', () => {
    store.createSession('dev', 9222, 12345);
    store.deleteSession('dev', true);
    expect(store.hasProfile('dev')).toBe(true);
  });

  it('hasProfile false after full delete', () => {
    store.createSession('dev', 9222, 12345);
    store.deleteSession('dev', false);
    expect(store.hasProfile('dev')).toBe(false);
  });
});
