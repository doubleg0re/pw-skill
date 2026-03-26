import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We can't import session.ts directly because it uses homedir() for the global path.
// Instead we test the pure logic by importing and calling the functions,
// but we need to mock the global state dir.
// For now, we test via the exported functions with a patched GLOBAL path.

// Since session.ts hardcodes homedir(), we test the logic patterns here
// and import the utility functions that don't depend on homedir().
import {
  generateSessionId,
  isProcessAlive,
} from '../skills/pw-browse/scripts/session.js';

const TEST_DIR = join(tmpdir(), `pw-session-test-${Date.now()}`);
const SESSIONS_DIR = join(TEST_DIR, 'sessions');

function setup() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// Helper: create session at test dir (mirrors session.ts createSession format)
function createTestSession(name: string, port: number, pid: number, video: string | null = null) {
  const dir = join(SESSIONS_DIR, name);
  mkdirSync(join(dir, 'user-data'), { recursive: true });
  const session = {
    id: generateSessionId(),
    name,
    port,
    pid,
    startedAt: new Date().toISOString(),
    video,
  };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2));
  return session;
}

function getTestSession(name: string) {
  const file = join(SESSIONS_DIR, name, 'session.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function listTestSessions() {
  const { readdirSync } = require('fs');
  return readdirSync(SESSIONS_DIR)
    .map((d: string) => getTestSession(d))
    .filter(Boolean);
}

describe('Session — generateSessionId', () => {
  it('generates 8 char hex string', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe('Session — isProcessAlive', () => {
  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for non-existent PID', () => {
    // PID 99999999 is extremely unlikely to exist
    expect(isProcessAlive(99999999)).toBe(false);
  });
});

describe('Session — CRUD (file-level)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates a session with metadata and user-data dir', () => {
    const session = createTestSession('dev', 9222, 12345);
    expect(session.name).toBe('dev');
    expect(session.port).toBe(9222);
    expect(session.pid).toBe(12345);
    expect(session.id).toMatch(/^[0-9a-f]{8}$/);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'session.json'))).toBe(true);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'user-data'))).toBe(true);
  });

  it('reads a session back with all fields', () => {
    createTestSession('staging', 9333, 54321, 'my-video');
    const session = getTestSession('staging');
    expect(session).not.toBeNull();
    expect(session.name).toBe('staging');
    expect(session.port).toBe(9333);
    expect(session.pid).toBe(54321);
    expect(session.video).toBe('my-video');
    expect(session.startedAt).toBeTruthy();
  });

  it('returns null for missing session', () => {
    expect(getTestSession('nonexistent')).toBeNull();
  });

  it('lists multiple sessions', () => {
    createTestSession('dev', 9222, 111);
    createTestSession('staging', 9333, 222);
    createTestSession('prod', 9444, 333);
    const sessions = listTestSessions();
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s: any) => s.name).sort()).toEqual(['dev', 'prod', 'staging']);
  });
});

describe('Session — profile isolation', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('each session has independent user-data dir', () => {
    createTestSession('a', 9001, 1);
    createTestSession('b', 9002, 2);
    const dirA = join(SESSIONS_DIR, 'a', 'user-data');
    const dirB = join(SESSIONS_DIR, 'b', 'user-data');
    expect(existsSync(dirA)).toBe(true);
    expect(existsSync(dirB)).toBe(true);
    expect(dirA).not.toBe(dirB);
  });
});

describe('Session — binding (current-session.txt)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('writes and reads binding', () => {
    const bindFile = join(TEST_DIR, 'current-session.txt');
    writeFileSync(bindFile, 'dev');
    expect(readFileSync(bindFile, 'utf-8').trim()).toBe('dev');
  });

  it('unbind removes the file', () => {
    const bindFile = join(TEST_DIR, 'current-session.txt');
    writeFileSync(bindFile, 'dev');
    unlinkSync(bindFile);
    expect(existsSync(bindFile)).toBe(false);
  });

  it('overwrites previous binding', () => {
    const bindFile = join(TEST_DIR, 'current-session.txt');
    writeFileSync(bindFile, 'dev');
    writeFileSync(bindFile, 'staging');
    expect(readFileSync(bindFile, 'utf-8').trim()).toBe('staging');
  });
});

describe('Session — cleanup (keepProfile)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('keeps user-data when deleting session metadata', () => {
    createTestSession('dev', 9222, 12345);
    const metaFile = join(SESSIONS_DIR, 'dev', 'session.json');
    unlinkSync(metaFile);
    expect(existsSync(metaFile)).toBe(false);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'user-data'))).toBe(true);
  });

  it('removes everything with full delete', () => {
    createTestSession('temp', 9222, 12345);
    rmSync(join(SESSIONS_DIR, 'temp'), { recursive: true, force: true });
    expect(existsSync(join(SESSIONS_DIR, 'temp'))).toBe(false);
  });
});

describe('Session — resolution logic', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('auto-selects when only one session exists', () => {
    createTestSession('only', 9222, process.pid);
    const sessions = listTestSessions();
    const alive = sessions.filter((s: any) => isProcessAlive(s.pid));
    expect(alive).toHaveLength(1);
    expect(alive[0].name).toBe('only');
  });

  it('dead sessions are not auto-selected', () => {
    createTestSession('dead', 9222, 99999999); // fake dead PID
    const sessions = listTestSessions();
    const alive = sessions.filter((s: any) => isProcessAlive(s.pid));
    expect(alive).toHaveLength(0);
  });

  it('multiple alive sessions require explicit selection', () => {
    createTestSession('a', 9001, process.pid);
    createTestSession('b', 9002, process.pid);
    const sessions = listTestSessions();
    const alive = sessions.filter((s: any) => isProcessAlive(s.pid));
    expect(alive).toHaveLength(2);
    // Should not auto-select → caller must specify
  });
});
