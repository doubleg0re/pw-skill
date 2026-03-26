// copy.ts — Copy element text/HTML (returns to stdout, not clipboard)
// Usage:
//   pw copy "#article"                        # textContent
//   pw copy "#article" --format=text          # textContent (default)
//   pw copy "#article" --format=html          # innerHTML
//   pw copy "#article" --format=outer         # outerHTML
//   pw copy "#table" --format=text            # table text
import { run, parseFlag } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: copy.ts <selector> [--format=text|html|outer]' };

  const format = parseFlag(process.argv.slice(2), 'format') || 'text';

  const content = await page.locator(selector).first().evaluate(
    (el, format) => {
      switch (format) {
        case 'html': return el.innerHTML;
        case 'outer': return el.outerHTML;
        case 'text':
        default: return el.textContent?.trim() || '';
      }
    },
    format,
  );

  return { success: true, data: { selector, format, content } };
});
