import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPwSettings, resolveRedactionLevel } from '../skills/pw-browse/scripts/settings.js';

const TEST_DIR = join(tmpdir(), `pw-settings-test-${Date.now()}`);

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

describe('loadPwSettings', () => {
  it('returns empty when no file', () => {
    expect(loadPwSettings(TEST_DIR)).toEqual({});
  });

  it('loads valid settings', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), JSON.stringify({ redactionLevel: 'verbose' }));
    expect(loadPwSettings(TEST_DIR)).toEqual({ redactionLevel: 'verbose' });
  });

  it('returns empty for malformed JSON', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), 'not json');
    expect(loadPwSettings(TEST_DIR)).toEqual({});
  });

  it('ignores invalid redactionLevel', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), JSON.stringify({ redactionLevel: 'banana' }));
    const settings = loadPwSettings(TEST_DIR);
    expect(settings.redactionLevel).toBeUndefined();
  });
});

describe('resolveRedactionLevel', () => {
  it('default is strict', () => {
    expect(resolveRedactionLevel({ cwd: TEST_DIR })).toBe('strict');
  });

  it('project setting overrides default', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), JSON.stringify({ redactionLevel: 'verbose' }));
    expect(resolveRedactionLevel({ cwd: TEST_DIR })).toBe('verbose');
  });

  it('--raw overrides project setting', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), JSON.stringify({ redactionLevel: 'strict' }));
    expect(resolveRedactionLevel({ cwd: TEST_DIR, cliRaw: true })).toBe('raw');
  });

  it('--redaction-level overrides project setting', () => {
    writeFileSync(join(TEST_DIR, '.pw-settings.json'), JSON.stringify({ redactionLevel: 'verbose' }));
    expect(resolveRedactionLevel({ cwd: TEST_DIR, cliLevel: 'strict' })).toBe('strict');
  });

  it('invalid CLI level falls back to project/default', () => {
    expect(resolveRedactionLevel({ cwd: TEST_DIR, cliLevel: 'banana' })).toBe('strict');
  });

  it('custom default level', () => {
    expect(resolveRedactionLevel({ cwd: TEST_DIR, defaultLevel: 'verbose' })).toBe('verbose');
  });
});
