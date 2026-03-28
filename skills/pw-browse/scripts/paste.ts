// paste.ts — Paste text or image from clipboard or direct input
// Usage:
//   pw paste                                # Ctrl+V at current focus
//   pw paste "#editor"                      # Click selector, then Ctrl+V
//   pw paste --text="hello world"           # Set clipboard text, then paste
//   pw paste "#editor" --text="hello"       # Click selector, set clipboard, paste
//   pw paste --image=./screenshot.png       # Paste image from file (ClipboardEvent)
//   pw paste "#editor" --image=./photo.png  # Click selector, paste image
import { run, parseFlag, hasFlag } from './common.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

run(async ({ page, args }) => {
  const selector = args[0];
  const text = parseFlag(process.argv.slice(2), 'text');
  const imagePath = parseFlag(process.argv.slice(2), 'image');

  // Click target if provided
  if (selector) {
    if (selector.startsWith('#') || selector.startsWith('.') || selector.startsWith('[')) {
      await page.locator(selector).first().click();
    } else {
      await page.getByText(selector, { exact: false }).first().click();
    }
  }

  // --- Image paste ---
  if (imagePath) {
    const absPath = resolve(imagePath);
    if (!existsSync(absPath)) return { success: false, error: `Image not found: ${absPath}` };

    const imageBuffer = readFileSync(absPath);
    const base64 = imageBuffer.toString('base64');
    // Detect mime type from extension
    const ext = absPath.toLowerCase().split('.').pop();
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    const mimeType = mimeMap[ext || ''] || 'image/png';

    await page.evaluate(
      async ({ base64, mimeType }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });
        const item = new ClipboardItem({ [mimeType]: blob });
        // Dispatch paste event with the image
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'pasted-image.' + mimeType.split('/')[1], { type: mimeType }));
        const el = document.activeElement || document.body;
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      },
      { base64, mimeType },
    );

    return {
      success: true,
      data: {
        type: 'image',
        file: absPath,
        mimeType,
        selector: selector || null,
        warnings: ['Image paste uses synthetic ClipboardEvent — may not work with all apps (e.g., native file upload zones)'],
      },
    };
  }

  // --- Text paste ---
  let clipboardOk: boolean | null = null;
  if (text) {
    clipboardOk = await page.evaluate(async (t) => {
      try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
    }, text).catch(() => false);
  }

  // Ctrl+V
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+v`);

  return {
    success: true,
    data: {
      type: 'text',
      text: text || '(clipboard)',
      selector: selector || null,
      clipboard: clipboardOk === null ? 'existing' : (clipboardOk ? 'ok' : 'failed'),
      ...(clipboardOk === false ? { warnings: ['Clipboard write denied by browser'] } : {}),
    },
  };
});
