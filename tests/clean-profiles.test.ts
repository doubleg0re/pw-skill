// clean-profiles.test.ts — the safety gate for `pw clean profiles`:
// only auto-generated throwaway profiles are removed by default, never
// intentionally-named ones (which may hold logins).
import { describe, it, expect } from 'vitest';
import { isEphemeralProfileName } from '../skills/pw-browse/scripts/clean.js';

describe('isEphemeralProfileName', () => {
  it('matches auto-generated throwaway names (s-<8 hex>)', () => {
    expect(isEphemeralProfileName('s-1a2b3c4d')).toBe(true);
    expect(isEphemeralProfileName('s-00000000')).toBe(true);
    expect(isEphemeralProfileName('s-deadbeef')).toBe(true);
  });

  it('spares intentional named profiles and near-misses', () => {
    expect(isEphemeralProfileName('work')).toBe(false);
    expect(isEphemeralProfileName('mybrave')).toBe(false);
    expect(isEphemeralProfileName('s-short')).toBe(false);       // too short
    expect(isEphemeralProfileName('s-1a2b3c4d5')).toBe(false);   // too long
    expect(isEphemeralProfileName('s-1A2B3C4D')).toBe(false);    // uppercase (ids are lower hex)
    expect(isEphemeralProfileName('prefix-s-1a2b3c4d')).toBe(false);
  });
});
