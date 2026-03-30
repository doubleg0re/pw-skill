import { describe, it, expect } from 'vitest';
import { headTruncate } from '../skills/pw-browse/scripts/dump-utils.js';

describe('headTruncate', () => {
  it('returns original content when head is undefined', () => {
    const result = headTruncate('hello world');
    expect(result.content).toBe('hello world');
    expect(result.truncated).toBe(false);
    expect(result.head).toBeUndefined();
    expect(result.originalLength).toBeUndefined();
  });

  it('returns original content when head >= content length', () => {
    const result = headTruncate('hello', 100);
    expect(result.content).toBe('hello');
    expect(result.truncated).toBe(false);
    expect(result.head).toBeUndefined();
    expect(result.originalLength).toBeUndefined();
  });

  it('returns original content when head equals content length', () => {
    const result = headTruncate('hello', 5);
    expect(result.content).toBe('hello');
    expect(result.truncated).toBe(false);
    expect(result.head).toBeUndefined();
    expect(result.originalLength).toBeUndefined();
  });

  it('truncates content when head < content length', () => {
    const result = headTruncate('hello world', 5);
    expect(result.content).toBe('hello');
    expect(result.truncated).toBe(true);
    expect(result.head).toBe(5);
    expect(result.originalLength).toBe(11);
  });

  it('truncates to zero chars', () => {
    const result = headTruncate('hello', 0);
    expect(result.content).toBe('');
    expect(result.truncated).toBe(true);
    expect(result.head).toBe(0);
    expect(result.originalLength).toBe(5);
  });

  it('handles empty content with head specified', () => {
    const result = headTruncate('', 10);
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.head).toBeUndefined();
    expect(result.originalLength).toBeUndefined();
  });

  it('handles empty content with no head', () => {
    const result = headTruncate('');
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });
});
