// ~/.claude/skills/pw-browse/scripts/dblclick.ts
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Target required. Usage: dblclick.ts <target> [--mode=selector|text|coord]' };

  const mode = parseFlag(process.argv.slice(2), 'mode') ?? detectMode(target);

  switch (mode) {
    case 'coord': {
      const [x, y] = target.split(',').map(Number);
      if (isNaN(x) || isNaN(y)) return { success: false, error: 'Invalid coordinates. Use: dblclick.ts 350,200 --mode=coord' };
      await page.mouse.dblclick(x, y);
      break;
    }
    case 'text':
      await page.getByText(target, { exact: false }).first().dblclick();
      break;
    case 'selector':
    default:
      await page.locator(target).first().dblclick();
      break;
  }

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { target, mode } };
});

function detectMode(target: string): string {
  if (/^\d+,\d+$/.test(target)) return 'coord';
  if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[') || target.includes('>')) return 'selector';
  return 'text';
}
