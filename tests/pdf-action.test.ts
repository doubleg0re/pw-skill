// pdf-action.test.ts — gitea #3: page.pdf() was not reachable from the CLI, so
// every HTML→PDF job meant writing a raw Playwright script.
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { actionPdf, parsePdfArgs } from '../skills/pw-browse/scripts/actions.js';

function makeFakePage(pdfImpl?: (opts: any) => Promise<void>) {
  const calls = { pdf: [] as any[], media: [] as any[] };
  const page: any = {
    pdf: async (opts: any) => {
      calls.pdf.push(opts);
      if (pdfImpl) await pdfImpl(opts);
    },
    emulateMedia: async (opts: any) => { calls.media.push(opts); },
  };
  return { page, calls };
}

const runtime = { session: { screenshotDir: join(tmpdir(), 'pw-pdf-test') } };
const outPath = join(tmpdir(), 'pw-pdf-test', 'report.pdf');

describe('parsePdfArgs', () => {
  it('defaults to A4 with backgrounds and print media', () => {
    const plan = parsePdfArgs([]);
    expect(plan.options.format).toBe('A4');
    expect(plan.options.printBackground).toBe(true);
    expect(plan.printMedia).toBe(true);
  });

  it('reads --out and --path alike', () => {
    expect(parsePdfArgs([`--out=${outPath}`]).out).toBe(outPath);
    expect(parsePdfArgs([`--path=${outPath}`]).out).toBe(outPath);
  });

  it('accepts the chain object form', () => {
    const plan = parsePdfArgs({ out: outPath, landscape: true } as any);
    expect(plan.out).toBe(outPath);
    expect(plan.options.landscape).toBe(true);
  });

  it('maps --pages to pageRanges', () => {
    expect(parsePdfArgs(['--pages=1-3']).options.pageRanges).toBe('1-3');
  });

  it('expands a single --margin value to all four sides', () => {
    expect(parsePdfArgs(['--margin=1cm']).options.margin)
      .toEqual({ top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' });
  });

  it('reads --margin as CSS shorthand', () => {
    expect(parsePdfArgs(['--margin=1cm,2cm']).options.margin)
      .toEqual({ top: '1cm', right: '2cm', bottom: '1cm', left: '2cm' });
  });

  it('honors --prefer-css-page-size and drops format so @page wins', () => {
    const plan = parsePdfArgs(['--prefer-css-page-size']);
    expect(plan.options.preferCSSPageSize).toBe(true);
    expect(plan.options.format).toBeUndefined();
  });

  it('opts out of backgrounds and print media', () => {
    const plan = parsePdfArgs(['--no-background', '--screen-media']);
    expect(plan.options.printBackground).toBe(false);
    expect(plan.printMedia).toBe(false);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parsePdfArgs(['--fullpage'])).toThrow(/--fullpage/);
  });

  it('rejects a scale outside the range Chromium accepts', () => {
    expect(() => parsePdfArgs(['--scale=5'])).toThrow(/scale/i);
    expect(parsePdfArgs(['--scale=0.5']).options.scale).toBe(0.5);
  });

  it('rejects a valueless --out instead of writing to a boolean path', () => {
    expect(() => parsePdfArgs({ out: true } as any)).toThrow(/--out needs a value/);
  });
});

describe('actionPdf', () => {
  it('writes to the requested path and reports it', async () => {
    const { page, calls } = makeFakePage();
    const { result } = await actionPdf(page, [`--out=${outPath}`], runtime as any);
    expect(calls.pdf[0]?.path).toBe(outPath);
    expect(result.pdf).toBe(outPath);
  });

  it('emulates print media and restores it afterwards', async () => {
    const { page, calls } = makeFakePage();
    await actionPdf(page, [`--out=${outPath}`], runtime as any);
    expect(calls.media[0]).toEqual({ media: 'print' });
    expect(calls.media[1]).toEqual({ media: null });
  });

  it('leaves media alone with --screen-media', async () => {
    const { page, calls } = makeFakePage();
    await actionPdf(page, [`--out=${outPath}`, '--screen-media'], runtime as any);
    expect(calls.media).toHaveLength(0);
  });

  it('falls back to the session artifact directory', async () => {
    const { page, calls } = makeFakePage();
    const { result } = await actionPdf(page, [], runtime as any);
    expect(result.pdf).toMatch(/pw-pdf-test\/.*\.pdf$/);
    expect(calls.pdf[0]?.path).toBe(result.pdf);
  });

  it('restores media even when the capture fails', async () => {
    const { page, calls } = makeFakePage(async () => { throw new Error('boom'); });
    await expect(actionPdf(page, [`--out=${outPath}`], runtime as any)).rejects.toThrow('boom');
    expect(calls.media[1]).toEqual({ media: null });
  });

  it('translates the headless-only failure into an actionable error', async () => {
    const { page } = makeFakePage(async () => {
      throw new Error('Page.pdf: PDF generation is only supported for Headless Chromium');
    });
    await expect(actionPdf(page, [`--out=${outPath}`], runtime as any))
      .rejects.toThrow(/headless chromium session/i);
  });
});
