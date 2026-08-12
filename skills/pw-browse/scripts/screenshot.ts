// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run } from './common.js';
import { actionScreenshot } from './actions.js';
import { GLOBAL_FLAG_NAMES, isGlobalFlagArg } from './chain-utils.js';

run(async ({ page, args, rawArgs, session }) => {
  // Forward every non-global flag verbatim; actionScreenshot is the single
  // source of truth for parsing them, so CLI, :: chains, and seq JSON all
  // behave identically — including rejecting a misspelled --fullpage, which
  // used to be dropped here and reported as a successful full-page capture.
  const actionArgs: string[] = [];
  if (args[0]) actionArgs.push(args[0]); // selector / 'full' / x,y,w,h
  actionArgs.push(...rawArgs.filter(a => a.startsWith('--') && !isGlobalFlagArg(a, GLOBAL_FLAG_NAMES)));

  const { result } = await actionScreenshot(page, actionArgs, { session });
  return { success: true, screenshot: (result as any).screenshot };
});
