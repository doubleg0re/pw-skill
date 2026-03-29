import { describe, it, expect } from 'vitest';
import { VarStore } from '../skills/pw-browse/scripts/sequence.js';

describe('VarStore', () => {
  describe('set/get', () => {
    it('stores and retrieves simple values', () => {
      const vars = new VarStore();
      vars.set('name', 'Alice');
      expect(vars.get('name')).toBe('Alice');
    });

    it('stores and retrieves nested objects', () => {
      const vars = new VarStore();
      vars.set('user', { name: 'Alice', role: 'admin' });
      expect(vars.get('user.name')).toBe('Alice');
      expect(vars.get('user.role')).toBe('admin');
    });

    it('accesses array elements by index', () => {
      const vars = new VarStore();
      vars.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(vars.get('items.0.id')).toBe(1);
      expect(vars.get('items.2.id')).toBe(3);
    });

    it('returns undefined for missing paths', () => {
      const vars = new VarStore();
      vars.set('user', { name: 'Alice' });
      expect(vars.get('user.email')).toBeUndefined();
      expect(vars.get('missing')).toBeUndefined();
      expect(vars.get('user.name.deep.path')).toBeUndefined();
    });

    it('handles null values in path', () => {
      const vars = new VarStore();
      vars.set('data', { value: null });
      expect(vars.get('data.value')).toBeNull();
      expect(vars.get('data.value.nested')).toBeUndefined();
    });
  });

  describe('interpolate', () => {
    it('replaces simple variable references', () => {
      const vars = new VarStore();
      vars.set('name', 'Alice');
      expect(vars.interpolate('Hello {{name}}')).toBe('Hello Alice');
    });

    it('replaces nested variable references', () => {
      const vars = new VarStore();
      vars.set('user', { name: 'Alice', scores: [10, 20, 30] });
      expect(vars.interpolate('{{user.name}}: {{user.scores.1}}')).toBe('Alice: 20');
    });

    it('replaces undefined/null with empty string', () => {
      const vars = new VarStore();
      vars.set('data', { value: null });
      expect(vars.interpolate('val={{missing}}')).toBe('val=');
      expect(vars.interpolate('val={{data.value}}')).toBe('val=');
    });

    it('returns original object for single template', () => {
      const vars = new VarStore();
      vars.set('obj', { a: 1 });
      expect(vars.interpolate('{{obj}}')).toEqual({ a: 1 });
    });

    it('serializes objects as JSON when embedded in string', () => {
      const vars = new VarStore();
      vars.set('obj', { a: 1 });
      expect(vars.interpolate('data: {{obj}}')).toBe('data: {"a":1}');
    });

    it('handles multiple replacements in one string', () => {
      const vars = new VarStore();
      vars.set('first', 'Hello');
      vars.set('second', 'World');
      expect(vars.interpolate('{{first}} {{second}}!')).toBe('Hello World!');
    });

    it('handles strings with no templates', () => {
      const vars = new VarStore();
      expect(vars.interpolate('no templates here')).toBe('no templates here');
    });

    it('trims whitespace in variable paths', () => {
      const vars = new VarStore();
      vars.set('name', 'Alice');
      expect(vars.interpolate('{{ name }}')).toBe('Alice');
    });
  });

  describe('interpolateArgs', () => {
    it('interpolates all args in array', () => {
      const vars = new VarStore();
      vars.set('sel', '#email');
      vars.set('val', 'test@test.com');
      expect(vars.interpolateArgs(['{{sel}}', '{{val}}'])).toEqual(['#email', 'test@test.com']);
    });
  });

  describe('snapshot', () => {
    it('returns a copy of all variables', () => {
      const vars = new VarStore();
      vars.set('a', 1);
      vars.set('b', 'two');
      const snap = vars.snapshot();
      expect(snap).toEqual({ a: 1, b: 'two' });
      // Should be a copy, not the same reference
      snap.c = 3;
      expect(vars.get('c')).toBeUndefined();
    });
  });
});

describe('VarStore — resolveValue', () => {
  it('resolves $ref to variable value', () => {
    const vars = new VarStore();
    vars.set('user', { name: 'Alice', age: 30 });
    expect(vars.resolveValue({ $ref: 'user.name' })).toBe('Alice');
    expect(vars.resolveValue({ $ref: 'user.age' })).toBe(30);
    expect(vars.resolveValue({ $ref: 'user' })).toEqual({ name: 'Alice', age: 30 });
  });

  it('$literal passes through as-is', () => {
    const vars = new VarStore();
    const literal = { $ref: 'not-a-reference' };
    expect(vars.resolveValue({ $literal: literal })).toEqual(literal);
  });

  it('recursively resolves arrays', () => {
    const vars = new VarStore();
    vars.set('x', 10);
    expect(vars.resolveValue([{ $ref: 'x' }, 'hello', 42])).toEqual([10, 'hello', 42]);
  });

  it('recursively resolves objects', () => {
    const vars = new VarStore();
    vars.set('name', 'Alice');
    expect(vars.resolveValue({ user: { $ref: 'name' }, static: 'value' })).toEqual({ user: 'Alice', static: 'value' });
  });

  it('string interpolation still works', () => {
    const vars = new VarStore();
    vars.set('x', 'world');
    expect(vars.resolveValue('hello {{x}}')).toBe('hello world');
  });

  it('throws on depth exceeded', () => {
    const vars = new VarStore();
    // Create deeply nested structure
    let deep: any = { value: 'end' };
    for (let i = 0; i < 25; i++) deep = { nested: deep };
    expect(() => vars.resolveValue(deep)).toThrow('depth exceeded');
  });

  it('preserves primitives', () => {
    const vars = new VarStore();
    expect(vars.resolveValue(42)).toBe(42);
    expect(vars.resolveValue(true)).toBe(true);
    expect(vars.resolveValue(null)).toBeNull();
  });
});
