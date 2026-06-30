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

  it('rejects a path-like selector with guidance toward --out', async () => {
    const { page } = makeFakePage();
    await expect(
      actionScreenshot(page, ['/private/tmp/design-dashboard.png'], runtime as any),
    ).rejects.toThrow(/--out/);
  });
});
