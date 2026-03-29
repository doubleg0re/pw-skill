// pw-chaining.test.ts — Tests for pw :: chaining arg parsing
// Verifies that per-step flags are preserved and global flags separated correctly.
import { describe, it, expect } from 'vitest';

// Replicate pw.ts chaining logic for testability
const CHAINABLE_ACTIONS = new Set([
  'navigate', 'screenshot', 'click', 'dblclick', 'hover', 'drag', 'scroll',
  'fill', 'type', 'select', 'upload', 'submit',
  'dump', 'attr', 'wait', 'fetch', 'evaluate',
]);

const GLOBAL_FLAG_NAMES = new Set(['session', 'headed', 'viewport', 'video', 'no-restore']);

function isGlobalFlag(a: string): boolean {
  if (!a.startsWith('--')) return false;
  const name = a.replace(/^--/, '').split('=')[0];
  return GLOBAL_FLAG_NAMES.has(name);
}

function parseChain(args: string[]): { segments: { action: string; args: string[] }[]; globalFlags: string[] } {
  const segments: { action: string; args: string[] }[] = [];
  let current: string[] = [];
  const globalFlags: string[] = [];
  for (const a of args) {
    if (a === '::') {
      if (current.length > 0) segments.push({ action: current[0], args: current.slice(1) });
      current = [];
    } else if (isGlobalFlag(a)) {
      globalFlags.push(a);
    } else {
      current.push(a);
    }
  }
  if (current.length > 0) segments.push({ action: current[0], args: current.slice(1) });
  return { segments, globalFlags };
}

function buildStepArgs(args: string[]): any {
  const hasFlags = args.some(a => a.startsWith('--'));
  if (!hasFlags) return args;
  const result: Record<string, any> = {};
  let idx = 0;
  for (const a of args) {
    if (a.startsWith('--')) {
      const eqIndex = a.indexOf('=');
      if (eqIndex > 0) result[a.slice(2, eqIndex)] = a.slice(eqIndex + 1);
      else result[a.slice(2)] = true;
    } else {
      result[idx] = a;
      idx++;
    }
  }
  return result;
}

// --- Tests ---

describe('pw chaining: parseChain', () => {
  it('parses simple two-step chain', () => {
    const { segments, globalFlags } = parseChain(['navigate', 'https://example.com', '::', 'screenshot']);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ action: 'navigate', args: ['https://example.com'] });
    expect(segments[1]).toEqual({ action: 'screenshot', args: [] });
    expect(globalFlags).toHaveLength(0);
  });

  it('separates global flags from step args', () => {
    const { segments, globalFlags } = parseChain([
      'navigate', 'https://example.com', '::', 'dump', '--selector=h1', '--text', '--session=dev',
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[1].args).toEqual(['--selector=h1', '--text']); // per-step
    expect(globalFlags).toEqual(['--session=dev']); // global
  });

  it('keeps --full as per-step flag', () => {
    const { segments } = parseChain(['screenshot', '--full']);
    expect(segments[0].args).toEqual(['--full']);
  });

  it('keeps --selector and --text as per-step flags', () => {
    const { segments } = parseChain(['dump', '--selector=#app', '--text']);
    expect(segments[0].args).toEqual(['--selector=#app', '--text']);
  });

  it('extracts --headed as global, keeps positional args', () => {
    const { segments, globalFlags } = parseChain(['navigate', 'url', '--headed']);
    expect(segments[0].args).toEqual(['url']);
    expect(globalFlags).toContain('--headed');
  });

  it('extracts --viewport as global', () => {
    const { globalFlags } = parseChain(['click', '#btn', '--viewport=800x600']);
    expect(globalFlags).toContain('--viewport=800x600');
  });
});

describe('pw chaining: buildStepArgs', () => {
  it('returns array for pure positional args', () => {
    expect(buildStepArgs(['https://example.com'])).toEqual(['https://example.com']);
  });

  it('converts flags to object', () => {
    const result = buildStepArgs(['--selector=h1', '--text']);
    expect(result).toEqual({ selector: 'h1', text: true });
  });

  it('mixes positional and flags', () => {
    const result = buildStepArgs(['#app', '--text']);
    expect(result).toEqual({ 0: '#app', text: true });
  });

  it('returns empty array for no args', () => {
    expect(buildStepArgs([])).toEqual([]);
  });
});

describe('pw chaining: CHAINABLE_ACTIONS', () => {
  it('includes common browser actions', () => {
    for (const action of ['navigate', 'click', 'fill', 'dump', 'screenshot', 'evaluate']) {
      expect(CHAINABLE_ACTIONS.has(action)).toBe(true);
    }
  });

  it('excludes session/admin commands', () => {
    for (const action of ['launch', 'close', 'sessions', 'rary', 'analyze', 'clean']) {
      expect(CHAINABLE_ACTIONS.has(action)).toBe(false);
    }
  });

  it('excludes actions not in ACTION_MAP (download, copy, paste, find)', () => {
    for (const action of ['download', 'copy', 'paste', 'find']) {
      expect(CHAINABLE_ACTIONS.has(action)).toBe(false);
    }
  });
});
