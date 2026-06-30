// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run, hasFlag, parseFlag } from './common.js';
import { actionScreenshot } from './actions.js';

run(async ({ page, args, session }) => {
  const argv = process.argv.slice(2);

  // Forward flags as tokens; actionScreenshot is the single source of truth for
  // parsing them, so CLI, :: chains, and seq JSON all behave identically.
  const actionArgs: string[] = [];
  if (args[0]) actionArgs.push(args[0]); // selector / 'full' / x,y,w,h
  if (hasFlag(argv, 'full')) actionArgs.push('--full');
  const out = parseFlag(argv, 'out') ?? parseFlag(argv, 'path');
  if (out) actionArgs.push(`--out=${out}`);
  const name = parseFlag(argv, 'name');
  if (name) actionArgs.push(`--name=${name}`);

  const { result } = await actionScreenshot(page, actionArgs, { session });
  return { success: true, screenshot: (result as any).screenshot };
});
