// copy.ts — 요소의 텍스트/HTML 복사 (클립보드가 아닌 stdout 반환)
// Usage:
//   pw copy "#article"                        # textContent
//   pw copy "#article" --format=text          # textContent (기본)
//   pw copy "#article" --format=html          # innerHTML
//   pw copy "#article" --format=outer         # outerHTML
//   pw copy "#table" --format=text            # 테이블 텍스트
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
