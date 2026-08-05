// browser-registry.test.ts — local-over-global merge for `--browser=<name>`
import { describe, it, expect } from 'vitest';
import { mergeRegistries } from '../skills/pw-browse/scripts/browser-registry.js';

describe('mergeRegistries', () => {
  it('local entries override global by name; others are unioned', () => {
    const global = { brave: { path: '/g/brave' }, chrome: { path: '/g/chrome' } };
    const local = { brave: { path: '/l/brave', defaultName: 'work' }, edge: { path: '/l/edge' } };
    expect(mergeRegistries(global, local)).toEqual({
      brave: { path: '/l/brave', defaultName: 'work' }, // local wins
      chrome: { path: '/g/chrome' }, // global kept
      edge: { path: '/l/edge' }, // local added
    });
  });

  it('handles empty scopes', () => {
    expect(mergeRegistries({}, {})).toEqual({});
    expect(mergeRegistries({ a: { path: '/a' } }, {})).toEqual({ a: { path: '/a' } });
    expect(mergeRegistries({}, { a: { path: '/a' } })).toEqual({ a: { path: '/a' } });
  });
});
