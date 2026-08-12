// tab-target.test.ts — --tab / --tab-id resolution
// gitea #2: an out-of-range --tab=N returned success and wrote into tab 0.
// gitea #5: tab indices reshuffle, so a long-running caller needs a stable id.
import { describe, expect, it, beforeEach } from 'vitest';
import {
  assignTabId,
  clearRegistry,
  resolveTabIdFlag,
  resolveTabIndexFlag,
} from '../skills/pw-browse/scripts/tab-registry.js';

describe('resolveTabIndexFlag (gitea #2)', () => {
  it('accepts an in-range index', () => {
    expect(resolveTabIndexFlag('1', 3)).toEqual({ index: 1 });
  });

  it('rejects an out-of-range index instead of falling back to tab 0', () => {
    const resolved = resolveTabIndexFlag('9', 1);
    expect(resolved.index).toBeUndefined();
    expect(resolved.error).toMatch(/--tab=9/);
    expect(resolved.error).toMatch(/1 tab open/);
  });

  it('names the valid range so the caller can correct itself', () => {
    expect(resolveTabIndexFlag('5', 3).error).toMatch(/0-2/);
  });

  it('rejects a non-numeric index', () => {
    expect(resolveTabIndexFlag('last', 3).error).toMatch(/--tab=last/);
  });

  it('rejects a negative index', () => {
    expect(resolveTabIndexFlag('-1', 3).error).toBeTruthy();
  });

  it('reports when no tabs are open at all', () => {
    expect(resolveTabIndexFlag('0', 0).error).toMatch(/no tabs/i);
  });
});

describe('resolveTabIdFlag (gitea #5)', () => {
  beforeEach(() => clearRegistry());

  it('finds the tab by target id regardless of its current position', () => {
    const tab = assignTabId('https://example.com/', 'Example', 2, 'T-abc');
    // The tab moved to the front since it was created.
    expect(resolveTabIdFlag(String(tab.tabId), ['T-abc', 'T-def'])).toEqual({ index: 0 });
  });

  it('survives navigation — identity is the target id, not the url', () => {
    const tab = assignTabId('https://example.com/', 'Example', 0, 'T-abc');
    expect(resolveTabIdFlag(String(tab.tabId), ['T-zzz', 'T-abc'])).toEqual({ index: 1 });
  });

  it('fails when the tab is gone rather than picking a neighbour', () => {
    const tab = assignTabId('https://example.com/', 'Example', 0, 'T-abc');
    const resolved = resolveTabIdFlag(String(tab.tabId), ['T-other']);
    expect(resolved.index).toBeUndefined();
    expect(resolved.error).toMatch(/no longer open/i);
  });

  it('fails on an unknown tab id', () => {
    expect(resolveTabIdFlag('42', ['T-abc']).error).toMatch(/--tab-id=42/);
  });

  it('rejects a non-numeric tab id', () => {
    expect(resolveTabIdFlag('abc', ['T-abc']).error).toMatch(/--tab-id=abc/);
  });

  it('fails when the tab was recorded without a target id', () => {
    const tab = assignTabId('https://example.com/', 'Example', 0);
    expect(resolveTabIdFlag(String(tab.tabId), ['T-abc']).error).toBeTruthy();
  });
});
