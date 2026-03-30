// ~/.claude/skills/pw-browse/scripts/click.ts
import { run, screenshotPath, parseFlag } from './common.js';
import { actionClick } from './actions.js';

run(async ({ page, args, session }) => {
  const key = parseFlag(process.argv.slice(2), 'key');
  const target = args[0];
  if (!target && !key) return { success: false, error: 'Target required. Usage: click.ts <target> [--key=<elementKey>]' };

  const actionArgs = key ? { key } : [target];
  const result = await actionClick(page, actionArgs, { session });

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { target: target || `key:${key}`, ...result?.result } };
});
