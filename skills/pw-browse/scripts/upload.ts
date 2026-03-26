// upload.ts — 파일 업로드
// Usage:
//   pw upload "#file-input" /path/to/file.pdf
//   pw upload "#photos" /path/a.jpg /path/b.jpg    # 다중 파일
import { run, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const files = args.slice(1);
  if (!selector || files.length === 0) return { success: false, error: 'Usage: upload.ts <selector> <file-path> [file-path...]' };

  await page.locator(selector).first().setInputFiles(files);

  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { selector, files } };
});
