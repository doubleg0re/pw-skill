// ~/.claude/skills/pw-browse/scripts/drag.ts
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const source = args[0];
  const target = args[1];
  if (!source || !target) return { success: false, error: 'Usage: drag.ts <source> <target> [--mode=selector|coord]' };

  const mode = parseFlag(process.argv.slice(2), 'mode') ?? (isCoord(source) && isCoord(target) ? 'coord' : 'selector');

  switch (mode) {
    case 'coord': {
      const [sx, sy] = source.split(',').map(Number);
      const [tx, ty] = target.split(',').map(Number);
      if ([sx, sy, tx, ty].some(isNaN)) return { success: false, error: 'Invalid coordinates. Use: drag.ts 100,200 300,400 --mode=coord' };
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(tx, ty, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case 'selector':
    default:
      await page.locator(source).first().dragTo(page.locator(target).first());
      break;
  }

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { source, target, mode } };
});

function isCoord(s: string): boolean {
  return /^\d+,\d+$/.test(s);
}
