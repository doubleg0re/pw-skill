// browser-catalog.test.ts — pure profile-list parsing + SingletonLock pid
import { describe, it, expect } from 'vitest';
import { parseProfiles, pidFromSingletonLock } from '../skills/pw-browse/scripts/browser-catalog.js';

describe('parseProfiles', () => {
  it('maps info_cache into profiles and flags last_used', () => {
    const localState = {
      profile: {
        last_used: 'Default',
        info_cache: {
          Default: { name: 'Mo' },
          'Profile 2': { name: 'Do' },
        },
      },
    };
    expect(parseProfiles(localState)).toEqual([
      { dir: 'Default', name: 'Mo', lastUsed: true },
      { dir: 'Profile 2', name: 'Do', lastUsed: false },
    ]);
  });

  it('falls back to the dir name when a profile has no display name', () => {
    const [p] = parseProfiles({ profile: { info_cache: { Default: {} } } });
    expect(p).toEqual({ dir: 'Default', name: 'Default', lastUsed: false });
  });

  it('returns [] for missing or malformed input instead of throwing', () => {
    expect(parseProfiles(null)).toEqual([]);
    expect(parseProfiles({})).toEqual([]);
    expect(parseProfiles({ profile: { info_cache: 'nope' } })).toEqual([]);
  });
});

describe('pidFromSingletonLock', () => {
  it('extracts the pid from a host-pid symlink target', () => {
    expect(pidFromSingletonLock('Mo-MBP-M1P.local-44783')).toBe(44783);
    expect(pidFromSingletonLock('host-with-dashes-in-name-12')).toBe(12);
  });

  it('returns null for empty or unparseable targets', () => {
    expect(pidFromSingletonLock(null)).toBeNull();
    expect(pidFromSingletonLock(undefined)).toBeNull();
    expect(pidFromSingletonLock('no-number-here')).toBeNull();
  });
});
