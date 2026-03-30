// select.ts — Select dropdown option from <select>
// Usage:
//   pw select "#country" --value=kr
//   pw select "#country" kr --value
//   pw select "#size" --label=Large
//   pw select "#size" Large --label
//   pw select "#color" --index=2
//   pw select "#color" 2 --index
import { run, parseFlag, hasFlag, screenshotPath } from './common.js';
import { actionSelect } from './actions.js';

run(async ({ page, args, session }) => {
  const selector = args[0];
  const positionalValue = args[1];
  if (!selector) return { success: false, error: 'Usage: select.ts <selector> (--value=x | --label=x | --index=n) or <selector> <value> --value|--label|--index' };

  const value = parseFlag(process.argv.slice(2), 'value');
  const label = parseFlag(process.argv.slice(2), 'label');
  const index = parseFlag(process.argv.slice(2), 'index');
  const hasValue = hasFlag(process.argv.slice(2), 'value');
  const hasLabel = hasFlag(process.argv.slice(2), 'label');
  const hasIndex = hasFlag(process.argv.slice(2), 'index');

  let optionValue: string;
  let mode: string;

  if (value !== undefined || hasValue) {
    optionValue = value ?? positionalValue;
    mode = 'value';
  } else if (label !== undefined || hasLabel) {
    optionValue = label ?? positionalValue;
    mode = 'label';
  } else if (index !== undefined || hasIndex) {
    optionValue = index ?? positionalValue;
    mode = 'index';
  } else {
    return { success: false, error: 'Specify one of: --value=x, --label=x, --index=n, or pass a positional value with --value|--label|--index' };
  }

  if (optionValue === undefined) {
    return { success: false, error: `No option specified for --${mode}. Use --${mode}=x or pass a positional value before --${mode}.` };
  }

  await actionSelect(page, [selector, optionValue, mode]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector, [mode]: optionValue } };
});
