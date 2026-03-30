// ~/.claude/skills/pw-browse/scripts/fill.ts
import { run, screenshotPath, parseFlag } from './common.js';
import { actionFill } from './actions.js';

run(async ({ page, args, session }) => {
  const key = parseFlag(process.argv.slice(2), 'key');
  const selector = args[0];
  const text = key ? args[0] : args[1]; // with --key, first positional is text
  if ((!selector && !key) || !text) return { success: false, error: 'Usage: fill.ts <selector> <text> [--key=<elementKey>]' };

  const actionArgs = key ? { key, value: text } : [selector, text];
  const result = await actionFill(page, actionArgs, { session });

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector: selector || `key:${key}`, text, ...result?.result } };
});
