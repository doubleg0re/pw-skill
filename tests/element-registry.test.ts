import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  generateElementKey,
  createElementRegistry,
  extractStableAttrs,
  verifyFingerprint,
  buildFallbackSelector,
  type ElementFingerprint,
} from '../skills/pw-browse/scripts/element-registry.js';

const TEST_DIR = join(import.meta.dirname || __dirname, '.tmp-element-registry-test');

function makeFp(overrides: Partial<ElementFingerprint> = {}): ElementFingerprint {
  return {
    key: 'abcd1234',
    session: 'test-session',
    tabId: 1,
    url: 'http://localhost:3000',
    documentEpoch: 1,
    createdAt: new Date().toISOString(),
    sourceSelector: '.item',
    sourceIndex: 0,
    tag: 'div',
    stableAttrs: {},
    ...overrides,
  };
}

describe('generateElementKey', () => {
  it('returns 8-char hex string', () => {
    const key = generateElementKey();
    expect(key).toMatch(/^[0-9a-f]{8}$/);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateElementKey()));
    expect(keys.size).toBe(100);
  });
});

describe('ElementRegistry', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('store and get', () => {
    const registry = createElementRegistry(TEST_DIR);
    const fp = makeFp();
    registry.store(fp);
    expect(registry.get('abcd1234')).toEqual(fp);
  });

  it('get returns undefined for missing key', () => {
    const registry = createElementRegistry(TEST_DIR);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('clear removes all entries', () => {
    const registry = createElementRegistry(TEST_DIR);
    registry.store(makeFp({ key: 'a1' }));
    registry.store(makeFp({ key: 'a2' }));
    registry.clear();
    expect(registry.get('a1')).toBeUndefined();
    expect(registry.get('a2')).toBeUndefined();
  });

  describe('validate', () => {
    it('valid when session, tabId, documentEpoch all match', () => {
      const registry = createElementRegistry(TEST_DIR);
      registry.store(makeFp());
      const result = registry.validate('abcd1234', 'test-session', 1, 1);
      expect(result.valid).toBe(true);
      expect(result.fingerprint).toBeDefined();
    });

    it('cross_session_key on session mismatch', () => {
      const registry = createElementRegistry(TEST_DIR);
      registry.store(makeFp());
      const result = registry.validate('abcd1234', 'other-session', 1, 1);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('cross_session_key');
    });

    it('cross_tab_key on tabId mismatch', () => {
      const registry = createElementRegistry(TEST_DIR);
      registry.store(makeFp());
      const result = registry.validate('abcd1234', 'test-session', 99, 1);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('cross_tab_key');
    });

    it('stale_key on documentEpoch mismatch', () => {
      const registry = createElementRegistry(TEST_DIR);
      registry.store(makeFp());
      const result = registry.validate('abcd1234', 'test-session', 1, 99);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('stale_key');
    });

    it('stale_key for missing key', () => {
      const registry = createElementRegistry(TEST_DIR);
      const result = registry.validate('nonexistent', 'test-session', 1, 1);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('stale_key');
    });
  });
});

describe('verifyFingerprint', () => {
  it('all match returns true', () => {
    const fp = makeFp({ tag: 'button', id: 'submit', classTokens: ['btn', 'primary'], stableAttrs: { role: 'button' }, textSnippetNormalized: 'Submit' });
    const candidate = { tag: 'button', id: 'submit', classTokens: ['btn', 'primary', 'extra'], stableAttrs: { role: 'button' }, textSnippetNormalized: 'Submit Form' };
    expect(verifyFingerprint(fp, candidate)).toBe(true);
  });

  it('tag mismatch returns false', () => {
    const fp = makeFp({ tag: 'button' });
    expect(verifyFingerprint(fp, { tag: 'div', stableAttrs: {} })).toBe(false);
  });

  it('id mismatch returns false', () => {
    const fp = makeFp({ tag: 'button', id: 'submit' });
    expect(verifyFingerprint(fp, { tag: 'button', id: 'cancel', stableAttrs: {} })).toBe(false);
  });

  it('no id in fingerprint skips id check', () => {
    const fp = makeFp({ tag: 'button' });
    expect(verifyFingerprint(fp, { tag: 'button', id: 'whatever', stableAttrs: {} })).toBe(true);
  });

  it('class token missing returns false', () => {
    const fp = makeFp({ tag: 'div', classTokens: ['btn', 'primary'] });
    expect(verifyFingerprint(fp, { tag: 'div', classTokens: ['btn'], stableAttrs: {} })).toBe(false);
  });

  it('class tokens undefined on candidate returns false', () => {
    const fp = makeFp({ tag: 'div', classTokens: ['btn'] });
    expect(verifyFingerprint(fp, { tag: 'div', stableAttrs: {} })).toBe(false);
  });

  it('stableAttr mismatch returns false', () => {
    const fp = makeFp({ tag: 'input', stableAttrs: { name: 'email' } });
    expect(verifyFingerprint(fp, { tag: 'input', stableAttrs: { name: 'phone' } })).toBe(false);
  });

  it('stableAttr missing on candidate returns false', () => {
    const fp = makeFp({ tag: 'input', stableAttrs: { name: 'email' } });
    expect(verifyFingerprint(fp, { tag: 'input', stableAttrs: {} })).toBe(false);
  });

  it('text snippet mismatch returns false', () => {
    const fp = makeFp({ tag: 'p', textSnippetNormalized: 'Hello World' });
    expect(verifyFingerprint(fp, { tag: 'p', stableAttrs: {}, textSnippetNormalized: 'Goodbye' })).toBe(false);
  });

  it('text snippet must be prefix match', () => {
    const fp = makeFp({ tag: 'p', textSnippetNormalized: 'Hello' });
    expect(verifyFingerprint(fp, { tag: 'p', stableAttrs: {}, textSnippetNormalized: 'Hello World' })).toBe(true);
    expect(verifyFingerprint(fp, { tag: 'p', stableAttrs: {}, textSnippetNormalized: 'Hi Hello' })).toBe(false);
  });

  it('text snippet undefined on candidate returns false when fp has one', () => {
    const fp = makeFp({ tag: 'p', textSnippetNormalized: 'Hello' });
    expect(verifyFingerprint(fp, { tag: 'p', stableAttrs: {} })).toBe(false);
  });

  it('no text snippet in fingerprint passes', () => {
    const fp = makeFp({ tag: 'div' });
    expect(verifyFingerprint(fp, { tag: 'div', stableAttrs: {}, textSnippetNormalized: 'anything' })).toBe(true);
  });
});

describe('buildFallbackSelector', () => {
  it('id takes highest priority', () => {
    const fp = makeFp({ id: 'main', stableAttrs: { 'data-testid': 'main-area', name: 'main' } });
    expect(buildFallbackSelector(fp)).toBe('#main');
  });

  it('data-testid second priority', () => {
    const fp = makeFp({ stableAttrs: { 'data-testid': 'submit-btn', name: 'submit' } });
    expect(buildFallbackSelector(fp)).toBe('[data-testid="submit-btn"]');
  });

  it('data-test third priority', () => {
    const fp = makeFp({ stableAttrs: { 'data-test': 'submit-btn' } });
    expect(buildFallbackSelector(fp)).toBe('[data-test="submit-btn"]');
  });

  it('name includes tag', () => {
    const fp = makeFp({ tag: 'input', stableAttrs: { name: 'email' } });
    expect(buildFallbackSelector(fp)).toBe('input[name="email"]');
  });

  it('aria-label', () => {
    const fp = makeFp({ stableAttrs: { 'aria-label': 'Close' } });
    expect(buildFallbackSelector(fp)).toBe('[aria-label="Close"]');
  });

  it('role', () => {
    const fp = makeFp({ stableAttrs: { role: 'dialog' } });
    expect(buildFallbackSelector(fp)).toBe('div[role="dialog"]');
  });

  it('null for no stable identity', () => {
    const fp = makeFp({ stableAttrs: {} });
    expect(buildFallbackSelector(fp)).toBeNull();
  });
});

describe('extractStableAttrs', () => {
  it('filters to only stable attrs', () => {
    const attrs = {
      'data-testid': 'btn',
      'data-test': 'btn-test',
      'name': 'submit',
      'aria-label': 'Submit',
      'role': 'button',
      'class': 'btn-primary',
      'id': 'submit-btn',
      'style': 'color: red',
      'href': '/foo',
    };
    expect(extractStableAttrs(attrs)).toEqual({
      'data-testid': 'btn',
      'data-test': 'btn-test',
      'name': 'submit',
      'aria-label': 'Submit',
      'role': 'button',
    });
  });

  it('returns empty for no stable attrs', () => {
    expect(extractStableAttrs({ class: 'foo', id: 'bar', href: '/baz' })).toEqual({});
  });

  it('handles empty input', () => {
    expect(extractStableAttrs({})).toEqual({});
  });
});
