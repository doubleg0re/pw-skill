// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run, hasFlag, parseFlag, screenshotPath } from './common.js';
import { actionScreenshot } from './actions.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const fullPage = hasFlag(process.argv.slice(2), 'full');
  const name = parseFlag(process.argv.slice(2), 'name');

  // Build args for actionScreenshot
  const actionArgs: string[] = [];
  if (fullPage) {
    actionArgs.push('full');
  } else if (selector) {
    actionArgs.push(selector);
  }
  if (name) actionArgs.push(name);

  const { result } = await actionScreenshot(page, actionArgs);

  return { success: true, screenshot: (result as any).screenshot };
});
