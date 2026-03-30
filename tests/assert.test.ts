import { describe, it, expect } from 'vitest';
import { normalizeText, evaluateAssertion } from '../skills/pw-browse/scripts/assert-utils.js';

describe('normalizeText', () => {
  it('trims whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('collapses whitespace runs', () => {
    expect(normalizeText('hello   world')).toBe('hello world');
  });

  it('converts \\u00a0 to regular space', () => {
    expect(normalizeText('hello\u00a0world')).toBe('hello world');
  });

  it('normalizes newlines', () => {
    expect(normalizeText('hello\nworld')).toBe('hello world');
  });

  it('handles mixed whitespace', () => {
    expect(normalizeText('  hello\u00a0\n\t world  ')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeText('')).toBe('');
  });
});

describe('evaluateAssertion', () => {
  it('exists passes when element exists', () => {
    const result = evaluateAssertion({ type: 'exists' }, '#el', true);
    expect(result.assertion).toBe('exists');
    expect(result.passed).toBe(true);
  });

  it('exists fails when element does not exist', () => {
    const result = evaluateAssertion({ type: 'exists' }, '#el', false);
    expect(result.assertion).toBe('exists');
    expect(result.passed).toBe(false);
  });

  it('text passes on exact normalized match', () => {
    const result = evaluateAssertion(
      { type: 'text', expected: 'Hello  World' },
      '#title', true, 'Hello\u00a0 World',
    );
    expect(result.passed).toBe(true);
    expect(result.actual).toBe('Hello World');
    expect(result.expected).toBe('Hello World');
  });

  it('text fails on mismatch', () => {
    const result = evaluateAssertion(
      { type: 'text', expected: 'Hello' },
      '#title', true, 'Goodbye',
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe('Goodbye');
  });

  it('text fails when element not found', () => {
    const result = evaluateAssertion(
      { type: 'text', expected: 'Hello' },
      '#title', false,
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe('[element not found]');
  });

  it('contains passes on substring match', () => {
    const result = evaluateAssertion(
      { type: 'contains', expected: 'World' },
      '#title', true, 'Hello World',
    );
    expect(result.passed).toBe(true);
  });

  it('contains fails on no substring match', () => {
    const result = evaluateAssertion(
      { type: 'contains', expected: 'xyz' },
      '#title', true, 'Hello World',
    );
    expect(result.passed).toBe(false);
  });

  it('contains normalizes both sides', () => {
    const result = evaluateAssertion(
      { type: 'contains', expected: 'Hello  World' },
      '#title', true, 'Say\u00a0Hello\nWorld!',
    );
    expect(result.passed).toBe(true);
  });

  it('attr passes on exact match', () => {
    const result = evaluateAssertion(
      { type: 'attr', expected: 'btn-primary' },
      '#btn', true, undefined, 'btn-primary',
    );
    expect(result.passed).toBe(true);
  });

  it('attr fails on mismatch', () => {
    const result = evaluateAssertion(
      { type: 'attr', expected: 'btn-primary' },
      '#btn', true, undefined, 'btn-secondary',
    );
    expect(result.passed).toBe(false);
  });

  it('attr fails when attribute not found', () => {
    const result = evaluateAssertion(
      { type: 'attr', expected: 'btn-primary' },
      '#btn', true, undefined, undefined,
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBeUndefined();
  });
});
