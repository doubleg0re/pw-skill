// screenshot-quality.ts — detect silently-degenerate (blank/solid) screenshots.
//
// Chrome/Playwright full-page captures can intermittently return a blank image
// with correct dimensions and no error (memory/size pressure, or an unpainted
// page). Blank/solid images compress to almost nothing, so a large capture
// that is tiny on disk is almost certainly degenerate. This turns a silent
// failure into a visible warning.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read width/height from a PNG's IHDR chunk without decoding pixels. */
export function parsePngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Captures smaller than this area (≈500×500) are element/region shots that can
// be legitimately tiny, so they are not judged.
const MIN_JUDGED_AREA = 250_000;
// Observed blank captures are ~2KB; the smallest healthy page capture seen is
// ~29KB. 4KB cleanly separates the two with margin.
const MIN_BYTES = 4096;
// Bytes-per-pixel below this means an almost-uniform image — flags huge
// full-page captures whose lower region blanked out (partial degeneration).
const MIN_BYTES_PER_PIXEL = 0.002;

export function isDegenerateCapture(
  byteLength: number,
  size: { width: number; height: number } | null,
): { degenerate: boolean; reason?: string } {
  if (!size) {
    // Couldn't read dimensions — fall back to absolute size only.
    return byteLength < MIN_BYTES
      ? { degenerate: true, reason: `screenshot is only ${byteLength} bytes — likely a blank capture` }
      : { degenerate: false };
  }

  const area = size.width * size.height;
  if (area < MIN_JUDGED_AREA) return { degenerate: false };

  if (byteLength < MIN_BYTES) {
    return { degenerate: true, reason: `screenshot is only ${byteLength} bytes for ${size.width}x${size.height} — likely a blank/solid capture` };
  }
  if (byteLength / area < MIN_BYTES_PER_PIXEL) {
    return { degenerate: true, reason: `screenshot has very low detail (${byteLength} bytes for ${size.width}x${size.height}) — capture may be partly blank` };
  }
  return { degenerate: false };
}
