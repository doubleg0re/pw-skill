import { describe, expect, it } from 'vitest';
import { buildChainStepArgs, buildInlineStepArgs, normalizeChainReference, splitLeadingGlobalFlags } from '../skills/pw-browse/scripts/chain-utils.js';

const GLOBALS = new Set(['session', 'headed', 'viewport', 'device', 'video', 'no-restore']);

describe('chain-utils', () => {
  it('normalizes $ret into sequence interpolation syntax', () => {
    expect(normalizeChainReference('$ret')).toBe('{{$ret}}');
    expect(normalizeChainReference('$ret.accessToken')).toBe('{{$ret.accessToken}}');
    expect(normalizeChainReference('/api/members')).toBe('/api/members');
  });

  it('builds chain args with normalized flag references', () => {
    expect(buildChainStepArgs(['GET', '/api/members', '--auth=$ret.accessToken'])).toEqual({
      0: 'GET',
      1: '/api/members',
      auth: '{{$ret.accessToken}}',
    });
  });

  it('builds positional chain args with normalized references', () => {
    expect(buildChainStepArgs(['$ret.accessToken'])).toEqual(['{{$ret.accessToken}}']);
  });

  it('resolves inline $ret references for pwi', () => {
    expect(buildInlineStepArgs(['GET', '/api/members', '--auth=$ret.accessToken'], {
      $ret: { accessToken: 'abc123' },
    })).toEqual({
      0: 'GET',
      1: '/api/members',
      auth: 'abc123',
    });
  });

  it('peels leading global flags off the front so the command token is found', () => {
    expect(splitLeadingGlobalFlags(['--session=awqa2', 'nav', 'http://x'], GLOBALS)).toEqual({
      leadingFlags: ['--session=awqa2'],
      rest: ['nav', 'http://x'],
    });
  });

  it('peels multiple leading global flags', () => {
    expect(splitLeadingGlobalFlags(['--session=s', '--headed', 'shot'], GLOBALS)).toEqual({
      leadingFlags: ['--session=s', '--headed'],
      rest: ['shot'],
    });
  });

  it('stops peeling at the first non-global token, leaving trailing flags in place', () => {
    expect(splitLeadingGlobalFlags(['eval', '1+1', '--session=s'], GLOBALS)).toEqual({
      leadingFlags: [],
      rest: ['eval', '1+1', '--session=s'],
    });
  });

  it('does not peel unknown flags', () => {
    expect(splitLeadingGlobalFlags(['--full', 'shot'], GLOBALS)).toEqual({
      leadingFlags: [],
      rest: ['--full', 'shot'],
    });
  });
});
