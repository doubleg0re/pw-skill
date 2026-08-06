// looks-like-function.test.ts — evaluate's function-vs-expression detection (#3)
import { describe, it, expect } from 'vitest';
import { looksLikeFunction } from '../skills/pw-browse/scripts/actions.js';

describe('looksLikeFunction', () => {
  it('detects arrow and function literals (meant to be called)', () => {
    expect(looksLikeFunction('() => {}')).toBe(true);
    expect(looksLikeFunction('() => { b.click(); return { ok: true }; }')).toBe(true);
    expect(looksLikeFunction('(a, b) => a + b')).toBe(true);
    expect(looksLikeFunction('x => x * 2')).toBe(true);
    expect(looksLikeFunction('async () => await f()')).toBe(true);
    expect(looksLikeFunction('function () { return 1; }')).toBe(true);
    expect(looksLikeFunction('function foo() {}')).toBe(true);
    expect(looksLikeFunction('  () => 1')).toBe(true); // leading whitespace
  });

  it('treats bare expressions as non-functions (evaluated as-is)', () => {
    expect(looksLikeFunction('1 + 1')).toBe(false);
    expect(looksLikeFunction('document.title')).toBe(false);
    expect(looksLikeFunction('window.location.href')).toBe(false);
    expect(looksLikeFunction('a >= b')).toBe(false); // >= is not =>
    expect(looksLikeFunction('[1,2,3].map(x => x)')).toBe(false); // starts with an array, returns a value
    expect(looksLikeFunction('')).toBe(false);
  });
});
