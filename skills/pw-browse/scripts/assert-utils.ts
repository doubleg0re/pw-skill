// assert-utils.ts — Pure utility functions for assertion evaluation

export type AssertionType = 'exists' | 'text' | 'contains' | 'attr' | 'visible' | 'hidden' | 'count';

export interface AssertionResult {
  assertion: AssertionType;
  target: string;
  passed: boolean;
  expected?: string;
  actual?: string;
}

/**
 * Normalize text for comparison:
 * - Replace \u00a0 (non-breaking space) with regular space
 * - Collapse all whitespace runs to single space
 * - Trim leading/trailing whitespace
 */
export function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Evaluate an assertion against element state.
 */
export function evaluateAssertion(
  input: { type: AssertionType; expected?: string },
  target: string,
  elementExists: boolean,
  actualText?: string,
  actualAttrValue?: string,
  extra?: { isVisible?: boolean; actualCount?: number },
): AssertionResult {
  const { type, expected } = input;

  if (type === 'exists') {
    return { assertion: 'exists', target, passed: elementExists };
  }

  if (type === 'visible') {
    return { assertion: 'visible', target, passed: !!extra?.isVisible };
  }

  if (type === 'hidden') {
    return { assertion: 'hidden', target, passed: !extra?.isVisible };
  }

  if (type === 'count') {
    const expectedCount = Number(expected);
    const actualCount = extra?.actualCount ?? 0;
    return {
      assertion: 'count',
      target,
      passed: actualCount === expectedCount,
      expected: String(expectedCount),
      actual: String(actualCount),
    };
  }

  if (!elementExists) {
    return {
      assertion: type,
      target,
      passed: false,
      expected,
      actual: '[element not found]',
    };
  }

  if (type === 'text') {
    const normalizedActual = normalizeText(actualText ?? '');
    const normalizedExpected = normalizeText(expected ?? '');
    return {
      assertion: 'text',
      target,
      passed: normalizedActual === normalizedExpected,
      expected: normalizedExpected,
      actual: normalizedActual,
    };
  }

  if (type === 'contains') {
    const normalizedActual = normalizeText(actualText ?? '');
    const normalizedExpected = normalizeText(expected ?? '');
    return {
      assertion: 'contains',
      target,
      passed: normalizedActual.includes(normalizedExpected),
      expected: normalizedExpected,
      actual: normalizedActual,
    };
  }

  if (type === 'attr') {
    return {
      assertion: 'attr',
      target,
      passed: actualAttrValue === expected,
      expected,
      actual: actualAttrValue ?? '[attribute not found]',
    };
  }

  return { assertion: type, target, passed: false };
}
