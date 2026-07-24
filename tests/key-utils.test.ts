import { describe, expect, it } from 'vitest';
import { normalizeKey } from '../skills/pw-browse/scripts/key-utils.js';

describe('normalizeKey', () => {
  it('canonicalizes named keys regardless of case', () => {
    expect(normalizeKey('enter')).toBe('Enter');
    expect(normalizeKey('Enter')).toBe('Enter');
    expect(normalizeKey('ESC')).toBe('Escape');
    expect(normalizeKey('escape')).toBe('Escape');
    expect(normalizeKey('tab')).toBe('Tab');
    expect(normalizeKey('del')).toBe('Delete');
    expect(normalizeKey('backspace')).toBe('Backspace');
  });

  it('expands arrow shorthands', () => {
    expect(normalizeKey('down')).toBe('ArrowDown');
    expect(normalizeKey('up')).toBe('ArrowUp');
    expect(normalizeKey('ArrowLeft')).toBe('ArrowLeft');
  });

  it('maps mac/windows modifier aliases to Playwright names', () => {
    expect(normalizeKey('cmd+z')).toBe('Meta+z');
    expect(normalizeKey('command+z')).toBe('Meta+z');
    expect(normalizeKey('ctrl+a')).toBe('Control+a');
    expect(normalizeKey('option+left')).toBe('Alt+ArrowLeft');
  });

  it('handles multi-modifier combos and stray whitespace', () => {
    expect(normalizeKey('Cmd+Shift+Z')).toBe('Meta+Shift+Z');
    expect(normalizeKey(' cmd + shift + z ')).toBe('Meta+Shift+z');
  });

  it('passes single characters and function keys through', () => {
    expect(normalizeKey('a')).toBe('a');
    expect(normalizeKey('Z')).toBe('Z');
    expect(normalizeKey('f5')).toBe('F5');
  });

  it('leaves unknown key names untouched so Playwright vocabulary still works', () => {
    expect(normalizeKey('Semicolon')).toBe('Semicolon');
    expect(normalizeKey('Digit1')).toBe('Digit1');
  });
});
