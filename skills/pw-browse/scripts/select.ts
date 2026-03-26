// select.ts — Select dropdown option from <select>
// Usage:
//   pw select "#country" --value=kr
//   pw select "#size" --label=Large
//   pw select "#color" --index=2
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: select.ts <selector> [--value=x | --label=x | --index=n]' };

  const value = parseFlag(process.argv.slice(2), 'value');
  const label = parseFlag(process.argv.slice(2), 'label');
  const index = parseFlag(process.argv.slice(2), 'index');

  let selected: string[];

  if (value) {
    selected = await page.locator(selector).first().selectOption({ value });
  } else if (label) {
    selected = await page.locator(selector).first().selectOption({ label });
  } else if (index) {
    selected = await page.locator(selector).first().selectOption({ index: parseInt(index) });
  } else {
    return { success: false, error: 'Specify one of: --value=x, --label=x, --index=n' };
  }

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector, selected } };
});
