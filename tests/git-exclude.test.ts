import { describe, expect, it } from 'vitest';
import { computeExcludeAppend } from '../skills/pw-browse/scripts/git-exclude.js';

const ENTRY = '.playwright-state/';

describe('git-exclude', () => {
  it('appends the entry to empty exclude content', () => {
    expect(computeExcludeAppend('', ENTRY)).toBe('.playwright-state/\n');
  });

  it('adds a leading newline when the file lacks a trailing newline', () => {
    expect(computeExcludeAppend('node_modules/', ENTRY)).toBe('\n.playwright-state/\n');
  });

  it('does not add a leading newline when the file already ends with one', () => {
    expect(computeExcludeAppend('node_modules/\n', ENTRY)).toBe('.playwright-state/\n');
  });

  it('returns null when the entry is already present', () => {
    expect(computeExcludeAppend('node_modules/\n.playwright-state/\n', ENTRY)).toBeNull();
  });

  it('ignores surrounding whitespace when detecting an existing entry', () => {
    expect(computeExcludeAppend('  .playwright-state/  \n', ENTRY)).toBeNull();
  });
});
