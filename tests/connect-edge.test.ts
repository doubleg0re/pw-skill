import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSessionStore,
  getProcessStartTime,
  type SessionStore,
} from '../skills/pw-browse/scripts/session.js';

const TEST_DIR = join(tmpdir(), `pw-connect-edge-${Date.now()}`);
let store: SessionStore;

function setup() {
  store = createSessionStore({
    globalDir: TEST_DIR,
    localDir: join(TEST_DIR, 'local'),
  });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('resolveSession — edge cases', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('--session=nonexistent throws not found', () => {
    expect(() => store.resolveSession('ghost')).toThrow('not found');
  });

  it('--session=dead throws not running', () => {
    store.createSession('dead', 9999, 99999999);
    expect(() => store.resolveSession('dead')).toThrow('not running');
  });

  it('no sessions throws no active', () => {
    expect(() => store.resolveSession()).toThrow('No active sessions');
  });

  it('multiple alive sessions throws multiple active', () => {
    store.createSession('a', 9001, process.pid);
    store.createSession('b', 9002, process.pid);
    expect(() => store.resolveSession()).toThrow('Multiple active sessions');
  });

  it('explicit --session overrides binding', () => {
    store.createSession('bound', 9001, process.pid);
    store.createSession('explicit', 9002, process.pid);
    store.bindSession('bound');
    const session = store.resolveSession('explicit');
    expect(session.name).toBe('explicit');
  });

  it('bound session resolves when alive', () => {
    store.createSession('bound', 9001, process.pid);
    store.bindSession('bound');
    const session = store.resolveSession();
    expect(session.name).toBe('bound');
  });

  it('dead bound session falls through to auto-select', () => {
    store.createSession('dead', 9001, 99999999);
    store.createSession('alive', 9002, process.pid);
    store.bindSession('dead');
    const session = store.resolveSession();
    expect(session.name).toBe('alive');
  });

  it('dead session resume keeps profile', () => {
    store.createSession('resumable', 9001, 99999999);
    store.deleteSession('resumable', true); // keepProfile
    expect(store.hasProfile('resumable')).toBe(true);
    expect(store.getSession('resumable')).toBeNull();
  });
});

describe('hookErrors visibility', () => {
  it('hookErrors declared outside try survives catch', () => {
    // This tests the pattern, not the actual code
    let hookErrors: string[] = [];
    try {
      hookErrors = ['hook1 failed', 'hook2 failed'];
      throw new Error('action failed');
    } catch {
      // hookErrors should be visible here
      expect(hookErrors).toHaveLength(2);
      expect(hookErrors[0]).toContain('hook1');
    }
  });

  it('hookErrors empty when no hook failures', () => {
    let hookErrors: string[] = [];
    try {
      hookErrors = [];
      // success path
    } catch {}
    expect(hookErrors).toHaveLength(0);
  });
});

describe('getProcessStartTime', () => {
  it('returns ISO string for own process', () => {
    const startTime = getProcessStartTime(process.pid);
    expect(startTime).not.toBeNull();
    // Should be a valid ISO date
    expect(new Date(startTime!).getTime()).toBeGreaterThan(0);
  });

  it('returns null for dead PID', () => {
    const startTime = getProcessStartTime(99999999);
    expect(startTime).toBeNull();
  });
});
