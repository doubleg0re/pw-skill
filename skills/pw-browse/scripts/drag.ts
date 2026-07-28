// ~/.claude/skills/pw-browse/scripts/drag.ts
import { run, screenshotPath, parseFlag, hasFlag } from './common.js';
import { actionDrag } from './actions.js';

run(async ({ page, args, session }) => {
  const argv = process.argv.slice(2);
  const source = args[0];
  const target = args[1];
  if (!source || !target) {
    return { success: false, error: 'Usage: drag <source|x,y> <target|x,y> [--grab=<anchor|x,y>] [--drop=<anchor|x,y>] [--steps=n] [--mouse]' };
  }

  const flags: string[] = [];
  const grab = parseFlag(argv, 'grab');
  if (grab !== undefined) flags.push(`--grab=${grab}`);
  const drop = parseFlag(argv, 'drop');
  if (drop !== undefined) flags.push(`--drop=${drop}`);
  const steps = parseFlag(argv, 'steps');
  if (steps !== undefined) flags.push(`--steps=${steps}`);
  if (hasFlag(argv, 'mouse')) flags.push('--mouse');

  const result = await actionDrag(page, [source, target, ...flags]);

  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { source, target, ...(result?.result || {}) } };
});
