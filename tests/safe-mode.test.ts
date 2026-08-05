// safe-mode.test.ts — restricted-mode resolution + guards
import { describe, it, expect } from 'vitest';
import { safeModeFrom, isSchemeAllowed, isPathWithinRoot } from '../skills/pw-browse/scripts/safe-mode.js';

describe('safeModeFrom', () => {
  it('turns on via PW_SAFE env (1 or true)', () => {
    expect(safeModeFrom({ PW_SAFE: '1' }, [])).toBe('env');
    expect(safeModeFrom({ PW_SAFE: 'true' }, [])).toBe('env');
  });
  it('turns on via the --safe flag anywhere in argv', () => {
    expect(safeModeFrom({}, ['pw', 'nav', '--safe', 'x'])).toBe('flag');
  });
  it('env wins over flag when both present', () => {
    expect(safeModeFrom({ PW_SAFE: '1' }, ['--safe'])).toBe('env');
  });
  it('is off by default and ignores non-truthy env values', () => {
    expect(safeModeFrom({}, [])).toBeNull();
    expect(safeModeFrom({ PW_SAFE: '0' }, [])).toBeNull();
    expect(safeModeFrom({ PW_SAFE: 'false' }, [])).toBeNull();
  });
});

describe('isSchemeAllowed', () => {
  it('allows http/https/about', () => {
    expect(isSchemeAllowed('http://localhost:3000')).toBe(true);
    expect(isSchemeAllowed('https://example.com/a')).toBe(true);
    expect(isSchemeAllowed('about:blank')).toBe(true);
  });
  it('blocks file://, chrome://, data:, and garbage', () => {
    expect(isSchemeAllowed('file:///Users/x/src/policy.ts')).toBe(false);
    expect(isSchemeAllowed('chrome://settings')).toBe(false);
    expect(isSchemeAllowed('data:text/html,<h1>x')).toBe(false);
    expect(isSchemeAllowed('not a url')).toBe(false);
  });
});

describe('isPathWithinRoot', () => {
  const cwd = '/tmp/app';
  const root = '/tmp/app/.playwright-state';
  it('allows paths that resolve inside the root', () => {
    expect(isPathWithinRoot('.playwright-state/shot.png', root, cwd)).toBe(true);
    expect(isPathWithinRoot('.playwright-state/dumps/a.html', root, cwd)).toBe(true);
    expect(isPathWithinRoot('/tmp/app/.playwright-state/x', root, cwd)).toBe(true);
  });
  it('rejects cwd-level, escaping, and sibling-prefix paths', () => {
    expect(isPathWithinRoot('page.html', root, cwd)).toBe(false); // cwd-level, outside the root
    expect(isPathWithinRoot('/etc/passwd', root, cwd)).toBe(false);
    expect(isPathWithinRoot('../secret.ts', root, cwd)).toBe(false);
    expect(isPathWithinRoot('.playwright-state-evil/x', root, cwd)).toBe(false); // sibling, not the root
  });
});
