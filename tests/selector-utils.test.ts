// selector-utils.test.ts — CSS-vs-text discrimination for click-like targets
import { describe, it, expect } from 'vitest';
import {
  isCoordinatePair,
  looksLikeSelector,
  resolveClickTarget,
} from '../skills/pw-browse/scripts/selector-utils.js';

describe('looksLikeSelector', () => {
  it('accepts sigil-led selectors', () => {
    expect(looksLikeSelector('#main')).toBe(true);
    expect(looksLikeSelector('.card')).toBe(true);
    expect(looksLikeSelector('[data-testid="row"]')).toBe(true);
  });

  it('accepts tag-qualified selectors (the reported miss)', () => {
    expect(looksLikeSelector("button[aria-label='Who We Are. 영상 재생']")).toBe(true);
    expect(looksLikeSelector('div#main')).toBe(true);
    expect(looksLikeSelector('a.link')).toBe(true);
    expect(looksLikeSelector('li:nth-child(2)')).toBe(true);
  });

  it('accepts Playwright engine syntax', () => {
    expect(looksLikeSelector('text=Sign in')).toBe(true);
    expect(looksLikeSelector('//button[1]')).toBe(true);
    expect(looksLikeSelector('.list >> nth=2')).toBe(true);
  });

  it('accepts a combinator when a sigil is present', () => {
    expect(looksLikeSelector('.nav > li')).toBe(true);
    expect(looksLikeSelector('div > [role=tab]')).toBe(true);
  });

  it('treats plain UI text as text', () => {
    expect(looksLikeSelector('Sign in')).toBe(false);
    expect(looksLikeSelector('Login')).toBe(false);
    expect(looksLikeSelector('확인')).toBe(false);
    expect(looksLikeSelector('Note: check this')).toBe(false);
    expect(looksLikeSelector('Ver. 2')).toBe(false);
  });

  it('keeps breadcrumb text out of the combinator rule', () => {
    // "Home > Settings" and ".nav > li" both contain '>', so the sigil is the tiebreaker.
    expect(looksLikeSelector('Home > Settings')).toBe(false);
  });

  it('ignores empty or blank targets', () => {
    expect(looksLikeSelector('')).toBe(false);
    expect(looksLikeSelector('   ')).toBe(false);
  });
});

describe('isCoordinatePair', () => {
  it('matches x,y pairs only', () => {
    expect(isCoordinatePair('120,340')).toBe(true);
    expect(isCoordinatePair('0,0')).toBe(true);
    expect(isCoordinatePair('.card')).toBe(false);
    expect(isCoordinatePair('120,340,10,10')).toBe(false);
  });
});

/**
 * Fake page whose locators resolve only for the strings listed in `visible`.
 * waitFor() rejects otherwise, standing in for a Playwright timeout.
 */
function makePage(visible: { selector?: string[]; text?: string[] } = {}) {
  const waited: string[] = [];
  const build = (kind: 'selector' | 'text', value: string) => ({
    kind,
    value,
    first() { return this; },
    async waitFor() {
      waited.push(`${kind}:${value}`);
      if (!(visible[kind] ?? []).includes(value)) throw new Error(`Timeout waiting for ${kind}`);
    },
  });
  const page: any = {
    locator: (sel: string) => build('selector', sel),
    getByText: (txt: string) => build('text', txt),
  };
  return { page, waited };
}

describe('resolveClickTarget — forced modes', () => {
  it('--mode=selector uses the CSS locator without probing', async () => {
    const { page, waited } = makePage();
    const locator: any = await resolveClickTarget(page, 'Sign in', { mode: 'selector' });
    expect(locator.kind).toBe('selector');
    expect(waited).toHaveLength(0);
  });

  it('--mode=text uses the text locator without probing', async () => {
    const { page, waited } = makePage();
    const locator: any = await resolveClickTarget(page, '.card', { mode: 'text' });
    expect(locator.kind).toBe('text');
    expect(waited).toHaveLength(0);
  });
});

describe('resolveClickTarget — auto resolution', () => {
  it('resolves a tag-qualified selector as CSS on the first try', async () => {
    const target = "button[aria-label='재생']";
    const { page, waited } = makePage({ selector: [target] });
    const locator: any = await resolveClickTarget(page, target, { timeout: 10 });
    expect(locator.kind).toBe('selector');
    expect(waited).toEqual([`selector:${target}`]);
  });

  it('resolves plain text as text on the first try', async () => {
    const { page, waited } = makePage({ text: ['Sign in'] });
    const locator: any = await resolveClickTarget(page, 'Sign in', { timeout: 10 });
    expect(locator.kind).toBe('text');
    expect(waited).toEqual(['text:Sign in']);
  });

  it('falls back to text when a selector-shaped target matches no element', async () => {
    // Link text that happens to read like CSS must still be clickable.
    const { page, waited } = makePage({ text: ['div.pricing'] });
    const locator: any = await resolveClickTarget(page, 'div.pricing', { timeout: 10 });
    expect(locator.kind).toBe('text');
    expect(waited).toEqual(['selector:div.pricing', 'text:div.pricing']);
  });

  it('falls back to CSS when a text-shaped target matches no text', async () => {
    const { page, waited } = makePage({ selector: ['div > span'] });
    const locator: any = await resolveClickTarget(page, 'div > span', { timeout: 10 });
    expect(locator.kind).toBe('selector');
    expect(waited).toEqual(['text:div > span', 'selector:div > span']);
  });

  it('fails fast with both interpretations and the escape hatch named', async () => {
    const { page, waited } = makePage();
    await expect(resolveClickTarget(page, '.missing', { timeout: 10 })).rejects.toThrow(
      /--mode=selector\|text/,
    );
    // Bounded: two probes, not one 30s auto-wait.
    expect(waited).toEqual(['selector:.missing', 'text:.missing']);
  });

  it('reports why each interpretation missed instead of swallowing the cause', async () => {
    const { page } = makePage();
    await expect(resolveClickTarget(page, '.missing', { timeout: 10 })).rejects.toThrow(
      /selector: Timeout waiting for selector[\s\S]*text: Timeout waiting for text/,
    );
  });

  it('splits one budget across both probes rather than spending it twice', async () => {
    const timeouts: number[] = [];
    const page: any = {
      locator: () => ({ first() { return this; }, async waitFor(o: any) { timeouts.push(o.timeout); throw new Error('miss'); } }),
      getByText: () => ({ first() { return this; }, async waitFor(o: any) { timeouts.push(o.timeout); throw new Error('miss'); } }),
    };
    await expect(resolveClickTarget(page, '.missing', { timeout: 1000 })).rejects.toThrow();
    expect(timeouts.reduce((sum, t) => sum + t, 0)).toBe(1000);
  });
});
