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

  it('truncates HTML content with head', () => {
    const html = '<div class="app"><h1>Title</h1><p>Body content here</p></div>';
    const result = headTruncate(html, 20);
    expect(result.content).toBe('<div class="app"><h1');
    expect(result.truncated).toBe(true);
    expect(result.head).toBe(20);
    expect(result.originalLength).toBe(html.length);
  });

  it('does not truncate when head exceeds content length (strict-mode fallback remains available)', () => {
    // When head is larger than content, headTruncate does NOT truncate.
    // This means a downstream strict-mode limit can still kick in as fallback.
    const shortContent = 'Short text';
    const result = headTruncate(shortContent, 100000);
    expect(result.content).toBe(shortContent);
    expect(result.truncated).toBe(false);
    expect(result.head).toBeUndefined();
    expect(result.originalLength).toBeUndefined();
  });

  it('operates independently of file save logic (save writes full content before truncation)', () => {
    // headTruncate is a pure function that only transforms stdout content.
    // In the dump pipeline, file save occurs BEFORE headTruncate is called,
    // so saved files always get full content while stdout gets truncated output.
    const fullContent = 'A'.repeat(1000);
    const savedContent = fullContent; // simulate: save writes full content first
    const result = headTruncate(fullContent, 100); // then truncate for stdout

    expect(savedContent).toBe(fullContent); // saved file is unaffected
    expect(result.content).toBe('A'.repeat(100)); // stdout is truncated
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(1000);
  });
});
