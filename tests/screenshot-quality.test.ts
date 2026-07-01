// screenshot-quality.test.ts — detect silently-degenerate (blank/solid) captures.
// Chrome full-page screenshots can silently return a blank image with correct
// dimensions and no error; observed blanks are ~2KB white PNGs while healthy
// captures are tens-to-hundreds of KB.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parsePngSize, isDegenerateCapture } from '../skills/pw-browse/scripts/screenshot-quality.js';
import { actionScreenshot } from '../skills/pw-browse/scripts/actions.js';

function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(8);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    Buffer.from([0, 0, 0, 13]), // IHDR length
    Buffer.from('IHDR'),
    ihdr, // width + height
    Buffer.from([8, 6, 0, 0, 0]), // bit depth, color type, etc.
  ]);
}

describe('parsePngSize', () => {
  it('reads width/height from the IHDR chunk', () => {
    expect(parsePngSize(pngHeader(1440, 900))).toEqual({ width: 1440, height: 900 });
    expect(parsePngSize(pngHeader(1280, 720))).toEqual({ width: 1280, height: 720 });
  });
  it('returns null for non-PNG data', () => {
    expect(parsePngSize(Buffer.from('not a png at all'))).toBeNull();
  });
});

describe('isDegenerateCapture', () => {
  it('flags a ~2KB full-viewport capture as blank (observed failure mode)', () => {
    expect(isDegenerateCapture(2048, { width: 1440, height: 900 }).degenerate).toBe(true);
  });
  it('passes a healthy capture (tens of KB)', () => {
    expect(isDegenerateCapture(78973, { width: 1440, height: 900 }).degenerate).toBe(false);
  });
  it('exempts small element/clip shots (too small to judge)', () => {
    expect(isDegenerateCapture(1500, { width: 100, height: 80 }).degenerate).toBe(false);
  });
  it('flags a huge near-solid full-page capture (partial blank)', () => {
    // 1440x100000 with only 50KB → almost entirely blank
    expect(isDegenerateCapture(50000, { width: 1440, height: 100000 }).degenerate).toBe(true);
  });
  it('passes a healthy full-page capture of the same huge size', () => {
    expect(isDegenerateCapture(1628637, { width: 1440, height: 100000 }).degenerate).toBe(false);
  });

  it('matches the real observed failure: ~2.7KB white blank vs healthy panels', () => {
    // From a real .dc host-console session: blanks were ~2.7KB; healthy panel
    // captures ranged 39KB–173KB. The guard must split them with margin.
    expect(isDegenerateCapture(2700, { width: 1440, height: 900 }).degenerate).toBe(true);
    for (const healthy of [39502, 42065, 76677, 119019, 173339]) {
      expect(isDegenerateCapture(healthy, { width: 1440, height: 900 }).degenerate).toBe(false);
    }
  });
});

// A fake page whose screenshot writes a valid PNG header padded to a given byte
// length, so actionScreenshot's on-disk inspection runs against real files.
function fakePageWriting(sizes: number[]) {
  let i = 0;
  const write = (p: string) => {
    const n = sizes[Math.min(i, sizes.length - 1)]; i++;
    writeFileSync(p, Buffer.concat([pngHeader(1440, 900), Buffer.alloc(Math.max(0, n - 33))]));
  };
  return {
    screenshot: async (opts: any) => write(opts.path),
    locator: () => ({ first: () => ({ screenshot: async (opts: any) => write(opts.path) }) }),
  };
}
const rt = { session: { screenshotDir: mkdtempSync(join(tmpdir(), 'pw-quality-')) } };

describe('actionScreenshot — degenerate capture guard', () => {
  it('warns when the capture is blank (~2KB)', async () => {
    const r = await actionScreenshot(fakePageWriting([2048]) as any, ['--full'], rt as any);
    expect(r.result.warning).toMatch(/blank|low detail/);
  });
  it('does not warn for a healthy capture', async () => {
    const r = await actionScreenshot(fakePageWriting([60000]) as any, ['--full'], rt as any);
    expect(r.result.warning).toBeUndefined();
  });
  it('retries once and recovers silently when the retry succeeds', async () => {
    const r = await actionScreenshot(fakePageWriting([2048, 60000]) as any, ['--full'], rt as any);
    expect(r.result.warning).toBeUndefined();
  });
  it('warns when the retry is also blank', async () => {
    const r = await actionScreenshot(fakePageWriting([2048, 2048]) as any, ['--full'], rt as any);
    expect(r.result.warning).toBeTruthy();
  });
});
