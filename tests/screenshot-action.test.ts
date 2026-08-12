// screenshot-action.test.ts — actionScreenshot flag/path handling
// Ensures --full and output-path behave identically across the three entry
// points: object args (:: chain), array args (seq JSON), positional (CLI).
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { actionScreenshot } from '../skills/pw-browse/scripts/actions.js';

function makeFakePage() {
  const calls = {
    page: [] as any[],
    locator: [] as Array<{ sel: string; opts: any }>,
  };
  const page: any = {
    screenshot: async (opts: any) => { calls.page.push(opts); },
    locator: (sel: string) => ({
      first: () => ({ screenshot: async (opts: any) => { calls.locator.push({ sel, opts }); } }),
    }),
  };
  return { page, calls };
}

// Pin screenshotPath() output to a temp dir so the default name path lands there.
const runtime = { session: { screenshotDir: join(tmpdir(), 'pw-shot-test') } };

describe('actionScreenshot — --full recognition (bug 1)', () => {
  it('honors full as an object key (:: chain form)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { full: true } as any, runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('honors --full as an array token (seq JSON form)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, ['--full'], runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('honors fullPage alias key', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { fullPage: true } as any, runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('still honors positional "full" (regression)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, ['full'], runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('no args → viewport screenshot, not full page (regression)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, [], runtime as any);
    expect(calls.page).toHaveLength(1);
    expect(calls.page[0]?.fullPage).toBeFalsy();
  });

  it('selector → element screenshot (regression)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, ['#hero'], runtime as any);
    expect(calls.locator[0]?.sel).toBe('#hero');
    expect(calls.page).toHaveLength(0);
  });
});

describe('actionScreenshot — output path (bug 3)', () => {
  const outPath = join(tmpdir(), 'pw-shot-test', 'panel.png');

  it('writes to --out=<path> verbatim (seq JSON form)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, [`--out=${outPath}`], runtime as any);
    expect(calls.page[0]?.path).toBe(outPath);
  });

  it('writes to out key verbatim (:: chain form)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { out: outPath } as any, runtime as any);
    expect(calls.page[0]?.path).toBe(outPath);
  });

  it('--out combines with --full', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, [`--out=${outPath}`, '--full'], runtime as any);
    expect(calls.page[0]?.path).toBe(outPath);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('routes a path-like positional to --out instead of treating it as a selector', async () => {
    const { page, calls } = makeFakePage();
    const positional = join(tmpdir(), 'pw-shot-test', 'design-dashboard.png');
    await actionScreenshot(page, [positional], runtime as any);
    expect(calls.page[0]?.path).toBe(positional);
    expect(calls.locator).toHaveLength(0);
  });

  it('routes a relative path-like positional too', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, ['./shots/hero.png'], runtime as any);
    expect(calls.page[0]?.path).toBe('./shots/hero.png');
    expect(calls.locator).toHaveLength(0);
  });
});

// gitea #1 — `--full-page` was accepted, ignored, and reported success, so a
// viewport capture came back as a verified full-page one.
describe('actionScreenshot — --full-page spelling (gitea #1)', () => {
  it('honors --full-page as an array token', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, ['--full-page'], runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('honors full-page as an object key (:: chain form)', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { 'full-page': true } as any, runtime as any);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('rejects an unknown flag instead of capturing anyway', async () => {
    const { page, calls } = makeFakePage();
    await expect(actionScreenshot(page, ['--fullpage'], runtime as any)).rejects.toThrow(/--fullpage/);
    expect(calls.page).toHaveLength(0);
    expect(calls.locator).toHaveLength(0);
  });

  it('rejects an unknown object key too', async () => {
    const { page } = makeFakePage();
    await expect(actionScreenshot(page, { fullpage: true } as any, runtime as any)).rejects.toThrow(/--fullpage/);
  });

  it('does not treat an unknown flag as a CSS selector', async () => {
    const { page, calls } = makeFakePage();
    await expect(actionScreenshot(page, ['--wide'], runtime as any)).rejects.toThrow();
    expect(calls.locator).toHaveLength(0);
  });
});

// gitea #1 (second half) — space-separated `--path` reaches the chain parser as
// `{ path: true }`, which used to surface as an internal Node TypeError.
describe('actionScreenshot — valueless value-taking flags (gitea #1)', () => {
  const outPath = join(tmpdir(), 'pw-shot-test', 'chained.png');

  it('resolves `--path <file>` from the chain form', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { path: true, 0: outPath } as any, runtime as any);
    expect(calls.page[0]?.path).toBe(outPath);
  });

  it('resolves `--out <file>` from the chain form', async () => {
    const { page, calls } = makeFakePage();
    await actionScreenshot(page, { out: true, 0: outPath, full: true } as any, runtime as any);
    expect(calls.page[0]?.path).toBe(outPath);
    expect(calls.page[0]?.fullPage).toBe(true);
  });

  it('fails with a usage error naming the flag when no value follows', async () => {
    const { page } = makeFakePage();
    await expect(actionScreenshot(page, { path: true } as any, runtime as any))
      .rejects.toThrow(/--path needs a value/);
  });

  it('does not swallow a selector as an output path', async () => {
    const { page } = makeFakePage();
    await expect(actionScreenshot(page, { path: true, 0: '#hero' } as any, runtime as any))
      .rejects.toThrow(/--path needs a value/);
  });

  it('fails on a valueless --name rather than writing to "true.png"', async () => {
    const { page } = makeFakePage();
    await expect(actionScreenshot(page, { name: true } as any, runtime as any))
      .rejects.toThrow(/--name needs a value/);
  });
});
