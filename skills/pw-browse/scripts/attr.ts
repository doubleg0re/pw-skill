// attr.ts — Read/write DOM attributes
// Usage:
//   pw attr "#btn" class                      # read
//   pw attr "#input" value                    # read
//   pw attr "#div" data-id --set=123          # write
//   pw attr "#el" textContent                 # read textContent
import { run, parseFlag } from './common.js';
import { actionAttr } from './actions.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const name = args[1];
  if (!selector || !name) return { success: false, error: 'Usage: attr.ts <selector> <attr-name> [--set=value]' };

  const setValue = parseFlag(process.argv.slice(2), 'set');

  if (setValue !== undefined) {
    await actionAttr(page, [selector, name, setValue]);
    return { success: true, data: { selector, attr: name, value: setValue, action: 'set' } };
  }

  const { result } = await actionAttr(page, [selector, name]);
  return { success: true, data: { selector, attr: name, value: result } };
});
