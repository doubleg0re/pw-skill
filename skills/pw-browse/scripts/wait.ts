// wait.ts — Conditional wait
// Usage:
//   pw wait 3000                              # wait 3 seconds
//   pw wait "#modal"                          # wait until selector is visible
//   pw wait "#status" --attr=textContent --value=done  # wait until selector attribute matches value
//   pw wait "#input" --attr=value --value=loaded       # wait until input value becomes "loaded"
import { run, parseFlag, screenshotPath } from './common.js';
import { actionWait } from './actions.js';

run(async ({ page, args, session }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Usage: wait.ts <ms | selector> [--attr=name --value=expected] [--timeout=ms]' };

  const attr = parseFlag(process.argv.slice(2), 'attr');
  const value = parseFlag(process.argv.slice(2), 'value');

  // Build args array for actionWait: [target, attr?, value?]
  const actionArgs = [target];
  if (attr && value !== undefined) {
    actionArgs.push(attr, value);
  }

  await actionWait(page, actionArgs);

  // Determine result type for CLI output
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(target)) {
    return { success: true, data: { until: target, type: 'until' } };
  }
  if (target.startsWith('http') || target.startsWith('/')) {
    const path = screenshotPath(undefined, session);
    await page.screenshot({ path });
    return { success: true, screenshot: path, data: { url: page.url(), type: 'url' } };
  }
  if (/^\d+$/.test(target)) {
    return { success: true, data: { waited: parseInt(target), type: 'time' } };
  }
  if (attr && value !== undefined) {
    const path = screenshotPath(undefined, session);
    await page.screenshot({ path });
    return { success: true, screenshot: path, data: { selector: target, attr, value, type: 'attr' } };
  }
  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });
  return { success: true, screenshot: path, data: { selector: target, type: 'visible' } };
});
