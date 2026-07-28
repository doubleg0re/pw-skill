// help-intercept.test.ts — `pw <action> --help` must be detected before the action runs
import { describe, it, expect } from 'vitest';
import { wantsHelp } from '../skills/pw-browse/scripts/chain-utils.js';

describe('wantsHelp', () => {
  it('detects --help anywhere in the argument list', () => {
    expect(wantsHelp(['--help'])).toBe(true);
    expect(wantsHelp(['down', '--help'])).toBe(true);
    expect(wantsHelp(['--full', '--help'])).toBe(true);
  });

  it('detects the -h short flag', () => {
    expect(wantsHelp(['-h'])).toBe(true);
    expect(wantsHelp(['#el', '-h'])).toBe(true);
  });

  it('is false when no help flag is present', () => {
    expect(wantsHelp([])).toBe(false);
    expect(wantsHelp(['down'])).toBe(false);
    expect(wantsHelp(['--full'])).toBe(false);
    expect(wantsHelp(['--out=/tmp/x.png', 'down'])).toBe(false);
    expect(wantsHelp(['--session=foo', '.card'])).toBe(false);
  });

  it('does not treat values containing "help" as the flag', () => {
    expect(wantsHelp(['helpme'])).toBe(false);
    expect(wantsHelp(['--helper'])).toBe(false);
    expect(wantsHelp(['Need help here'])).toBe(false);
  });
});
