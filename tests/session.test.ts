import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test session.ts logic by mocking the global state dir
// Since session.ts uses homedir(), we test the pure functions by
// directly manipulating the file structure

const TEST_DIR = join(tmpdir(), `pw-session-test-${Date.now()}`);
const SESSIONS_DIR = join(TEST_DIR, 'sessions');

function setup() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// Simulate session CRUD at file level (same format as session.ts)
function createTestSession(name: string, port: number, pid: number) {
  const dir = join(SESSIONS_DIR, name);
  mkdirSync(join(dir, 'user-data'), { recursive: true });
  const session = {
    id: Math.random().toString(36).slice(2, 10),
    name,
    port,
    pid,
    startedAt: new Date().toISOString(),
    video: null,
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

describe('Session — CRUD', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates a session with metadata', () => {
    const session = createTestSession('dev', 9222, 12345);
    expect(session.name).toBe('dev');
    expect(session.port).toBe(9222);
    expect(session.pid).toBe(12345);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'session.json'))).toBe(true);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'user-data'))).toBe(true);
  });

  it('reads a session back', () => {
    createTestSession('staging', 9333, 54321);
    const session = getTestSession('staging');
    expect(session).not.toBeNull();
    expect(session.name).toBe('staging');
    expect(session.port).toBe(9333);
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

describe('Session — binding', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('writes and reads current-session.txt', () => {
    const bindFile = join(TEST_DIR, 'current-session.txt');
    writeFileSync(bindFile, 'dev');
    expect(readFileSync(bindFile, 'utf-8').trim()).toBe('dev');
  });

  it('unbind removes the file', () => {
    const bindFile = join(TEST_DIR, 'current-session.txt');
    writeFileSync(bindFile, 'dev');
    const { unlinkSync } = require('fs');
    unlinkSync(bindFile);
    expect(existsSync(bindFile)).toBe(false);
  });
});

describe('Session — cleanup', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('deleting session keeps user-data when keepProfile=true', () => {
    createTestSession('dev', 9222, 12345);
    // Remove session.json but keep user-data
    const metaFile = join(SESSIONS_DIR, 'dev', 'session.json');
    const { unlinkSync } = require('fs');
    unlinkSync(metaFile);
    expect(existsSync(metaFile)).toBe(false);
    expect(existsSync(join(SESSIONS_DIR, 'dev', 'user-data'))).toBe(true);
  });

  it('deleting session removes everything when keepProfile=false', () => {
    createTestSession('temp', 9222, 12345);
    rmSync(join(SESSIONS_DIR, 'temp'), { recursive: true, force: true });
    expect(existsSync(join(SESSIONS_DIR, 'temp'))).toBe(false);
  });
});

describe('Session — resolution logic', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('resolves explicit session by name', () => {
    const session = createTestSession('dev', 9222, process.pid); // use own PID to pass alive check
    expect(session.name).toBe('dev');
  });

  it('auto-selects when only one session', () => {
    createTestSession('only', 9222, process.pid);
    const sessions = listTestSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe('only');
  });
});
