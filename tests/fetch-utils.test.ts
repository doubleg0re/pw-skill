import { describe, expect, it } from 'vitest';
import { normalizeAuthHeader, resolveFetchCredentials } from '../skills/pw-browse/scripts/fetch-utils.js';

describe('fetch-utils', () => {
  it('defaults credentials to include', () => {
    expect(resolveFetchCredentials()).toBe('include');
  });

  it('accepts valid credentials modes', () => {
    expect(resolveFetchCredentials('omit')).toBe('omit');
    expect(resolveFetchCredentials('same-origin')).toBe('same-origin');
    expect(resolveFetchCredentials('include')).toBe('include');
  });

  it('rejects invalid credentials modes', () => {
    expect(() => resolveFetchCredentials('banana')).toThrow(/Invalid credentials mode/);
  });

  it('prefixes bare auth values with Bearer', () => {
    expect(normalizeAuthHeader('abc123')).toBe('Bearer abc123');
  });

  it('preserves explicit auth schemes', () => {
    expect(normalizeAuthHeader('Bearer abc123')).toBe('Bearer abc123');
    expect(normalizeAuthHeader('Basic xyz')).toBe('Basic xyz');
  });

  it('returns undefined for empty auth values', () => {
    expect(normalizeAuthHeader('')).toBeUndefined();
    expect(normalizeAuthHeader('   ')).toBeUndefined();
  });
});
