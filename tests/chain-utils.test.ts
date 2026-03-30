import { describe, expect, it } from 'vitest';
import { buildChainStepArgs, buildInlineStepArgs, normalizeChainReference } from '../skills/pw-browse/scripts/chain-utils.js';

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
});
