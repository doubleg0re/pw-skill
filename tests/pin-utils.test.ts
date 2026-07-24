import { describe, expect, it } from 'vitest';
import { originOf, pinViolation } from '../skills/pw-browse/scripts/pin-utils.js';

describe('originOf', () => {
  it('extracts the origin, ignoring path and query', () => {
    expect(originOf('http://localhost:3100/scenes?id=1')).toBe('http://localhost:3100');
    expect(originOf('https://app.example.com/a/b')).toBe('https://app.example.com');
  });

  it('treats ports as part of the origin', () => {
    expect(originOf('http://localhost:3100/')).not.toBe(originOf('http://localhost:3010/'));
  });

  it('returns null for non-navigable urls', () => {
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });
});

describe('pinViolation', () => {
  it('allows anything when no pin is set', () => {
    expect(pinViolation(undefined, 'http://localhost:3010/')).toBeNull();
  });

  it('allows a matching origin regardless of path', () => {
    expect(pinViolation('http://localhost:3100', 'http://localhost:3100/scenes/42')).toBeNull();
  });

  it('flags drift to a different origin', () => {
    const msg = pinViolation('http://localhost:3100', 'http://localhost:3010/admin');
    expect(msg).toContain('http://localhost:3100');
    expect(msg).toContain('http://localhost:3010');
    expect(msg).toContain('--no-pin-check');
  });

  it('does not block blank/unparseable pages, which are not drift', () => {
    expect(pinViolation('http://localhost:3100', 'about:blank')).toBeNull();
  });
});
