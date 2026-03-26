// attr.ts — Read/write DOM attributes
// Usage:
//   pw attr "#btn" class                      # read
//   pw attr "#input" value                    # read
//   pw attr "#div" data-id --set=123          # write
//   pw attr "#el" textContent                 # read textContent
import { run, parseFlag } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const name = args[1];
  if (!selector || !name) return { success: false, error: 'Usage: attr.ts <selector> <attr-name> [--set=value]' };

  const setValue = parseFlag(process.argv.slice(2), 'set');

  if (setValue !== undefined) {
    await page.locator(selector).first().evaluate(
      (el, { name, value }) => {
        if (name === 'textContent') el.textContent = value;
        else if (name === 'innerText') (el as HTMLElement).innerText = value;
        else if (name === 'value') (el as HTMLInputElement).value = value;
        else el.setAttribute(name, value);
      },
      { name, value: setValue },
    );
    return { success: true, data: { selector, attr: name, value: setValue, action: 'set' } };
  }

  const value = await page.locator(selector).first().evaluate(
    (el, name) => {
      if (name === 'textContent') return el.textContent?.trim() ?? null;
      if (name === 'innerText') return (el as HTMLElement).innerText?.trim() ?? null;
      if (name === 'value') return (el as HTMLInputElement).value ?? null;
      return el.getAttribute(name);
    },
    name,
  );

  return { success: true, data: { selector, attr: name, value } };
});
