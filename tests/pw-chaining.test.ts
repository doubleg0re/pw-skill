// pw-chaining.test.ts — Tests for pw :: chaining arg parsing
// Now uses shared chain-utils instead of duplicating the logic.
import { describe, it, expect } from 'vitest';
import {
  CHAINABLE_ACTION_SET,
  parseChainSegments,
  buildChainStepArgs,
} from '../skills/pw-browse/scripts/chain-utils.js';

const GLOBAL_FLAG_NAMES = new Set(['session', 'headed', 'viewport', 'video', 'no-restore']);

// --- Tests ---

describe('pw chaining: parseChainSegments', () => {
  it('parses simple two-step chain', () => {
    const { segments, globalFlags } = parseChainSegments(
      ['navigate', 'https://example.com', '::', 'screenshot'],
      GLOBAL_FLAG_NAMES,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ action: 'navigate', args: ['https://example.com'] });
    expect(segments[1]).toEqual({ action: 'screenshot', args: [] });
    expect(globalFlags).toHaveLength(0);
  });

  it('separates global flags from step args', () => {
    const { segments, globalFlags } = parseChainSegments([
      'navigate', 'https://example.com', '::', 'dump', '--selector=h1', '--text', '--session=dev',
    ], GLOBAL_FLAG_NAMES);
    expect(segments).toHaveLength(2);
    expect(segments[1].args).toEqual(['--selector=h1', '--text']); // per-step
    expect(globalFlags).toEqual(['--session=dev']); // global
  });

  it('keeps --full as per-step flag', () => {
    const { segments } = parseChainSegments(['screenshot', '--full'], GLOBAL_FLAG_NAMES);
    expect(segments[0].args).toEqual(['--full']);
  });

  it('keeps --selector and --text as per-step flags', () => {
    const { segments } = parseChainSegments(['dump', '--selector=#app', '--text'], GLOBAL_FLAG_NAMES);
    expect(segments[0].args).toEqual(['--selector=#app', '--text']);
  });

  it('extracts --headed as global, keeps positional args', () => {
    const { segments, globalFlags } = parseChainSegments(['navigate', 'url', '--headed'], GLOBAL_FLAG_NAMES);
    expect(segments[0].args).toEqual(['url']);
    expect(globalFlags).toContain('--headed');
  });

  it('extracts --viewport as global', () => {
    const { globalFlags } = parseChainSegments(['click', '#btn', '--viewport=800x600'], GLOBAL_FLAG_NAMES);
    expect(globalFlags).toContain('--viewport=800x600');
  });
});

describe('pw chaining: buildChainStepArgs', () => {
  it('returns array for pure positional args', () => {
    expect(buildChainStepArgs(['https://example.com'])).toEqual(['https://example.com']);
  });

  it('converts flags to object', () => {
    const result = buildChainStepArgs(['--selector=h1', '--text']);
    expect(result).toEqual({ selector: 'h1', text: true });
  });

  it('mixes positional and flags', () => {
    const result = buildChainStepArgs(['#app', '--text']);
    expect(result).toEqual({ 0: '#app', text: true });
  });

  it('returns empty array for no args', () => {
    expect(buildChainStepArgs([])).toEqual([]);
  });
});

describe('pw chaining: CHAINABLE_ACTION_SET', () => {
  it('includes common browser actions', () => {
    for (const action of ['navigate', 'click', 'fill', 'dump', 'screenshot', 'evaluate', 'console', 'network', 'dialog']) {
      expect(CHAINABLE_ACTION_SET.has(action)).toBe(true);
    }
  });

  it('excludes session/admin commands', () => {
    for (const action of ['launch', 'close', 'sessions', 'rary', 'analyze', 'clean']) {
      expect(CHAINABLE_ACTION_SET.has(action)).toBe(false);
    }
  });

  it('excludes actions not in ACTION_MAP (download, copy, paste, find)', () => {
    for (const action of ['download', 'copy', 'paste', 'find']) {
      expect(CHAINABLE_ACTION_SET.has(action)).toBe(false);
    }
  });
});
