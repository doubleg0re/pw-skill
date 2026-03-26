// submit.ts — Form submission
// Usage:
//   pw submit                          # Press Enter (submit focused form)
//   pw submit "#login-form"            # Submit specific form by selector
//   pw submit "#login-form" --wait=/dashboard  # Submit + wait for navigation
import { run, parseFlag, screenshotPath } from './common.js';

run(async ({ page, args }) => {
  const selector = args[0];
  const waitUrl = parseFlag(process.argv.slice(2), 'wait');

  if (selector) {
    await page.locator(selector).first().evaluate((form: HTMLFormElement) => form.submit());
  } else {
    await page.keyboard.press('Enter');
  }

  // navigation 대기
  if (waitUrl) {
    await page.waitForURL(waitUrl.includes('*') ? waitUrl : `**${waitUrl}*`, { timeout: 30000 });
  } else {
    await page.waitForTimeout(1000);
  }

  const path = screenshotPath();
  await page.screenshot({ path });

  return { success: true, screenshot: path, data: { selector: selector || 'Enter', url: page.url() } };
});
