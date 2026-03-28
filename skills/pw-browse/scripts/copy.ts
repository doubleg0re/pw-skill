// copy.ts — Copy element text/HTML/image
// Usage:
//   pw copy "#article"                        # textContent → clipboard + stdout
//   pw copy "#article" --format=text          # textContent (default)
//   pw copy "#article" --format=html          # innerHTML
//   pw copy "#article" --format=outer         # outerHTML
//   pw copy "img.hero" --format=image         # Save image element to file
//   pw copy "img.hero" --format=image --dir=./assets
import { run, parseFlag, screenshotPath, ensureStateDir } from './common.js';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: copy.ts <selector> [--format=text|html|outer|image] [--dir=path]' };

  const format = parseFlag(process.argv.slice(2), 'format') || 'text';

  // --- Image mode: save element as image file ---
  if (format === 'image') {
    const dir = parseFlag(process.argv.slice(2), 'dir')
      || join(resolve(process.cwd(), '.playwright-state'), 'screenshots');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const name = parseFlag(process.argv.slice(2), 'name');
    const filename = name ? (name.endsWith('.png') ? name : `${name}.png`) : `${Date.now()}.png`;
    const savePath = join(dir, filename);

    // Try to get the image src and save it
    const tagName = await page.locator(selector).first().evaluate(el => el.tagName.toLowerCase());

    if (tagName === 'img' || tagName === 'picture' || tagName === 'canvas') {
      // For img: screenshot the element directly
      await page.locator(selector).first().screenshot({ path: savePath });
    } else {
      // For other elements: screenshot the element
      await page.locator(selector).first().screenshot({ path: savePath });
    }

    // Also try to copy the image src URL
    const src = await page.locator(selector).first().evaluate(el => {
      if (el.tagName === 'IMG') return (el as HTMLImageElement).src;
      const img = el.querySelector('img');
      return img ? img.src : null;
    }).catch(() => null);

    return { success: true, data: { selector, format: 'image', path: savePath, src } };
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

  // Copy to clipboard via browser API
  await page.evaluate(async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  }, content).catch(() => {});

  return { success: true, data: { selector, format, content, clipboard: true } };
});
