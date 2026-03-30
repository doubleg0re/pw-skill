// ~/.claude/skills/pw-browse/scripts/screenshot.ts
import { run, hasFlag, parseFlag, screenshotPath } from './common.js';
import { actionScreenshot } from './actions.js';

run(async ({ page, args, session }) => {
  const selector = args[0];
  const fullPage = hasFlag(process.argv.slice(2), 'full');
  const name = parseFlag(process.argv.slice(2), 'name');

  // Build args for actionScreenshot
  // actionScreenshot expects: [target?, name?] where target is 'full', selector, or coordinates
  // name is only recognized as second arg (a.length >= 2)
  const actionArgs: string[] = [];
  if (fullPage) {
    actionArgs.push('full');
    if (name) actionArgs.push(name);
  } else if (selector) {
    actionArgs.push(selector);
    if (name) actionArgs.push(name);
  } else if (name) {
    // Name only, no selector — use screenshotPath directly
    const path = (await import('./common.js')).screenshotPath(name, session);
    await page.screenshot({ path });
    return { success: true, screenshot: path };
  }

  const { result } = await actionScreenshot(page, actionArgs, { session });

  return { success: true, screenshot: (result as any).screenshot };
});
