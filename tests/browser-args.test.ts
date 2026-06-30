// browser-args.test.ts — Chromium launch args for the detached browser server.
// Headless has no real OS window, so viewport:null ("auto") collapses to
// Chromium's 800x600 default. A default --window-size keeps auto captures sane.
import { describe, it, expect } from 'vitest';
import { buildChromiumArgs } from '../skills/pw-browse/scripts/browser-args.js';

describe('buildChromiumArgs', () => {
  it('sets a default window size in headless so auto viewport is not 800x600', () => {
    const args = buildChromiumArgs(true, 9222);
    expect(args).toContain('--window-size=1440,900');
  });

  it('does not force a window size in headed mode (real window dictates size)', () => {
    const args = buildChromiumArgs(false, 9222);
    expect(args.some(a => a.startsWith('--window-size'))).toBe(false);
  });

  it('always wires the given remote debugging port', () => {
    expect(buildChromiumArgs(true, 12345)).toContain('--remote-debugging-port=12345');
    expect(buildChromiumArgs(false, 12345)).toContain('--remote-debugging-port=12345');
  });
});
