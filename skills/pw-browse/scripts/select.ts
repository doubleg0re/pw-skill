// select.ts — Select dropdown option from <select>
// Usage:
//   pw select "#country" --value=kr
//   pw select "#size" --label=Large
//   pw select "#color" --index=2
import { run, parseFlag, screenshotPath } from './common.js';
import { actionSelect } from './actions.js';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: select.ts <selector> [--value=x | --label=x | --index=n]' };

  const value = parseFlag(process.argv.slice(2), 'value');
  const label = parseFlag(process.argv.slice(2), 'label');
  const index = parseFlag(process.argv.slice(2), 'index');

  let optionValue: string;
  let mode: string;

  if (value) {
    optionValue = value;
    mode = 'value';
  } else if (label) {
    optionValue = label;
    mode = 'label';
  } else if (index) {
    optionValue = index;
    mode = 'index';
  } else {
    return { success: false, error: 'Specify one of: --value=x, --label=x, --index=n' };
  }

  await actionSelect(page, [selector, optionValue, mode]);

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector, [mode]: optionValue } };
});
