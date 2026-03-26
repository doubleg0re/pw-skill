// hover.ts — Hover mouse over element
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const target = args[0];
  if (!target) return { success: false, error: 'Usage: hover.ts <target> [--mode=selector|text|coord]' };

  const mode = parseFlag(process.argv.slice(2), 'mode') ?? detectMode(target);

  switch (mode) {
    case 'coord': {
      const [x, y] = target.split(',').map(Number);
      if (isNaN(x) || isNaN(y)) return { success: false, error: 'Invalid coordinates' };
      await page.mouse.move(x, y);
      break;
    }
    case 'text':
      await page.getByText(target, { exact: false }).first().hover();
      break;
    case 'selector':
    default:
      await page.locator(target).first().hover();
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
