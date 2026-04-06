import { run, screenshotPath } from './common.js';
import { actionResize } from './actions.js';

run(async ({ page, args, session }) => {
  const size = args[0];
  if (!size) return { success: false, error: 'Size required. Usage: resize.ts <width>x<height>' };

  const { result } = await actionResize(page, [size]);
  const path = screenshotPath(undefined, session);
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: result };
});
