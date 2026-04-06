import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRunScriptCandidates, resolveRunScriptPath } from '../skills/pw-browse/scripts/run-command.js';

function makeTempDir(): string {
  return join(tmpdir(), `pw-run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('run-command', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTempDir();
    mkdirSync(join(cwd, 'scripts', 'playwright'), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('prefers scripts/playwright for bare script names', () => {
    const scriptPath = join(cwd, 'scripts', 'playwright', 'login.ts');
    writeFileSync(scriptPath, 'console.log("ok");');

    expect(resolveRunScriptPath('login.ts', cwd)).toBe(scriptPath);
  });

  it('adds runnable extensions for bare names', () => {
    const candidates = buildRunScriptCandidates('login', cwd);
    expect(candidates).toContain(join(cwd, 'scripts', 'playwright', 'login.ts'));
    expect(candidates).toContain(join(cwd, 'login.ts'));
  });

  it('resolves explicit relative paths directly', () => {
    const scriptPath = join(cwd, 'custom', 'flow.ts');
    mkdirSync(join(cwd, 'custom'), { recursive: true });
    writeFileSync(scriptPath, 'console.log("ok");');

    expect(resolveRunScriptPath('./custom/flow.ts', cwd)).toBe(scriptPath);
  });

  it('returns null when no candidate exists', () => {
    expect(resolveRunScriptPath('missing-script', cwd)).toBeNull();
  });
});
