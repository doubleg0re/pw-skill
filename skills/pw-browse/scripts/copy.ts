// copy.ts — Copy element text/HTML/image to clipboard and/or file
// Usage:
//   pw copy "#article"                              # textContent → clipboard + stdout
//   pw copy "#article" --format=text                # textContent (default)
//   pw copy "#article" --format=html                # innerHTML
//   pw copy "#article" --format=outer               # outerHTML
//   pw copy "img.hero" --format=image               # Image → clipboard (as PNG blob)
//   pw copy "img.hero" --format=image --save-only   # Image → file only, skip clipboard
//   pw copy "img.hero" --format=image --dir=./assets --name=hero
import { run, parseFlag, hasFlag } from './common.js';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: copy.ts <selector> [--format=text|html|outer|image] [--save-only] [--dir=path] [--name=N]' };

  const format = parseFlag(process.argv.slice(2), 'format') || 'text';
  const saveOnly = hasFlag(process.argv.slice(2), 'save-only');

  // --- Image mode ---
  if (format === 'image') {
    const dir = parseFlag(process.argv.slice(2), 'dir')
      || join(resolve(process.cwd(), '.playwright-state'), 'screenshots');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const name = parseFlag(process.argv.slice(2), 'name');
    const filename = name ? (name.endsWith('.png') ? name : `${name}.png`) : `${Date.now()}.png`;
    const savePath = join(dir, filename);

    // Screenshot the element
    await page.locator(selector).first().screenshot({ path: savePath });

    // Copy to clipboard as image blob (unless --save-only)
    let clipboardOk = false;
    if (!saveOnly) {
      const imageBuffer = readFileSync(savePath);
      const base64 = imageBuffer.toString('base64');
      clipboardOk = await page.evaluate(async (b64) => {
        try {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'image/png' });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          return true;
        } catch {
          return false;
        }
      }, base64).catch(() => false);
    }

    // Get image src if available
    const src = await page.locator(selector).first().evaluate(el => {
      if (el.tagName === 'IMG') return (el as HTMLImageElement).src;
      const img = el.querySelector('img');
      return img ? img.src : null;
    }).catch(() => null);

    return {
      success: true,
      data: {
        selector,
        format: 'image',
        path: savePath,
        src,
        clipboard: saveOnly ? 'skipped' : (clipboardOk ? 'ok' : 'failed (browser permission denied)'),
      },
    };
  }

  // --- Text/HTML mode ---
  const content = await page.locator(selector).first().evaluate(
    (el, fmt) => {
      switch (fmt) {
        case 'html': return el.innerHTML;
        case 'outer': return el.outerHTML;
        case 'text':
        default: return el.textContent?.trim() || '';
      }
    },
    format,
  );

  // Copy to clipboard
  const clipboardOk = await page.evaluate(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, content).catch(() => false);

  return {
    success: true,
    data: {
      selector,
      format,
      content,
      clipboard: clipboardOk ? 'ok' : 'failed (browser permission denied)',
    },
  };
});
