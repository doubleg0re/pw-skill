// normalize-step.test.ts — shorthand normalization, including nested block steps
import { describe, it, expect } from 'vitest';
import { normalizeStep } from '../skills/pw-browse/scripts/sequence-params.js';

describe('normalizeStep', () => {
  it('normalizes a top-level shorthand step', () => {
    expect(normalizeStep({ nav: 'https://x' })).toEqual({ action: 'nav', args: ['https://x'] });
    expect(normalizeStep({ fill: ['#a', 'b'] })).toEqual({ action: 'fill', args: ['#a', 'b'] });
  });

  it('leaves an already-explicit leaf step alone', () => {
    expect(normalizeStep({ action: 'wait', args: [500] })).toEqual({ action: 'wait', args: [500] });
  });

  it('recurses shorthand into try/loop items and then/else/finally', () => {
    expect(normalizeStep({ action: 'try', items: [{ click: 'text=Go' }, { wait: 1500 }] })).toEqual({
      action: 'try',
      items: [{ action: 'click', args: ['text=Go'] }, { action: 'wait', args: [1500] }],
    });
    expect(normalizeStep({ action: 'condition', ref: 'v', then: [{ click: 'a' }], else: [{ nav: 'b' }] })).toEqual({
      action: 'condition', ref: 'v', then: [{ action: 'click', args: ['a'] }], else: [{ action: 'nav', args: ['b'] }],
    });
  });

  it('accepts `steps` as an alias for `items`', () => {
    expect(normalizeStep({ action: 'try', steps: [{ click: 'x' }] })).toEqual({
      action: 'try',
      items: [{ action: 'click', args: ['x'] }],
    });
  });

  it('normalizes deeply nested blocks', () => {
    const deep = normalizeStep({ action: 'try', items: [{ action: 'loop', count: 2, items: [{ click: 'x' }] }] });
    expect(deep.items[0].items).toEqual([{ action: 'click', args: ['x'] }]);
  });

  it('does not touch condition-def items (ConditionNode[]) or set object items', () => {
    const condDef = normalizeStep({ action: 'def', type: 'condition', name: 'c', items: [{ ref: 'a' }] });
    expect(condDef.items).toEqual([{ ref: 'a' }]); // untouched — not steps
    const setStep = normalizeStep({ action: 'set', items: { x: { value: 1 } } });
    expect(setStep.items).toEqual({ x: { value: 1 } }); // object, untouched
  });
});
