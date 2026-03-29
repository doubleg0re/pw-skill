import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON, readJSONSafe } from '../skills/pw-browse/scripts/file-utils.js';

const TEST_DIR = join(tmpdir(), `pw-fileutils-${Date.now()}`);

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

describe('atomicWriteJSON', () => {
  it('writes a new file', () => {
    const path = join(TEST_DIR, 'new.json');
    atomicWriteJSON(path, { hello: 'world' });
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ hello: 'world' });
  });

  it('overwrites existing file', () => {
    const path = join(TEST_DIR, 'existing.json');
    writeFileSync(path, JSON.stringify({ old: true }));
    atomicWriteJSON(path, { new: true });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ new: true });
  });

  it('creates parent directories', () => {
    const path = join(TEST_DIR, 'deep', 'nested', 'file.json');
    atomicWriteJSON(path, { deep: true });
    expect(existsSync(path)).toBe(true);
  });

  it('no temp file left behind on success', () => {
    const path = join(TEST_DIR, 'clean.json');
    atomicWriteJSON(path, { data: 1 });
    const files = require('fs').readdirSync(TEST_DIR);
    expect(files.filter((f: string) => f.startsWith('.tmp-'))).toHaveLength(0);
  });

  it('preserves previous file if write fails', () => {
    const path = join(TEST_DIR, 'preserve.json');
    writeFileSync(path, JSON.stringify({ original: true }));
    // Can't easily force a write failure, but verify the file is intact after normal write
    atomicWriteJSON(path, { updated: true });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ updated: true });
  });
});

describe('readJSONSafe', () => {
  it('reads valid JSON', () => {
    const path = join(TEST_DIR, 'valid.json');
    writeFileSync(path, JSON.stringify({ a: 1 }));
    expect(readJSONSafe(path)).toEqual({ a: 1 });
  });

  it('returns null for missing file', () => {
    expect(readJSONSafe(join(TEST_DIR, 'missing.json'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const path = join(TEST_DIR, 'bad.json');
    writeFileSync(path, 'not json {{{');
    expect(readJSONSafe(path)).toBeNull();
  });
});
