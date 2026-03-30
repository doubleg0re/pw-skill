// assert.ts — Assert element state (exists, text, contains, attr)
// Usage:
//   pw assert "#title" --exists
//   pw assert "#title" --text="Hello World"
//   pw assert "#title" --contains="Hello"
//   pw assert "#title" --attr=class --value=active
//   pw assert "#title" --text="Hello" --wait=3000
import { run, parseFlag, hasFlag } from './common.js';
import { evaluateAssertion, type AssertionType } from './assert-utils.js';

const POLL_INTERVAL = 100;

run(async ({ page }) => {
  const cliArgs = process.argv.slice(2);

  // Positional: first non-flag arg is selector
  const selector = cliArgs.find(a => !a.startsWith('--'));
  if (!selector) {
    return { success: false, error: 'Missing selector. Usage: pw assert <selector> --exists|--text=...|--contains=...|--attr=...' };
  }

  // Determine assertion type
  const isExists = hasFlag(cliArgs, 'exists');
  const textVal = parseFlag(cliArgs, 'text');
  const containsVal = parseFlag(cliArgs, 'contains');
  const attrName = parseFlag(cliArgs, 'attr');
  const attrValue = parseFlag(cliArgs, 'value');
  const waitRaw = parseFlag(cliArgs, 'wait');
  const waitMs = waitRaw !== undefined ? Number(waitRaw) : 0;

  let type: AssertionType;
  let expected: string | undefined;

  if (isExists) {
    type = 'exists';
  } else if (textVal !== undefined) {
    type = 'text';
    expected = textVal;
  } else if (containsVal !== undefined) {
    type = 'contains';
    expected = containsVal;
  } else if (attrName !== undefined) {
    type = 'attr';
    expected = attrValue;
  } else {
    return { success: false, error: 'Missing assertion flag. Use --exists, --text=..., --contains=..., or --attr=... --value=...' };
  }

  async function evaluate() {
    const elementExists = await page.locator(selector!).count().then(c => c > 0);

    let actualText: string | undefined;
    let actualAttrValue: string | undefined;

    if (elementExists && (type === 'text' || type === 'contains')) {
      actualText = await page.locator(selector!).first().evaluate(
        (el) => (el as HTMLElement).innerText,
      );
    }

    if (elementExists && type === 'attr' && attrName) {
      actualAttrValue = await page.locator(selector!).first().evaluate(
        (el, name) => {
          if (name === 'textContent') return el.textContent?.trim();
          if (name === 'innerText') return (el as HTMLElement).innerText?.trim();
          if (name === 'value') return (el as HTMLInputElement).value;
          return el.getAttribute(name);
        },
        attrName,
      ).then(v => v ?? undefined);
    }

    return evaluateAssertion({ type, expected }, selector!, elementExists, actualText, actualAttrValue);
  }

  // Immediate evaluation (no wait)
  if (!waitMs) {
    const data = await evaluate();
    return { success: data.passed, data };
  }

  // Poll with retry
  const start = Date.now();
  let attempts = 0;
  let lastResult = await evaluate();
  attempts++;

  while (!lastResult.passed && (Date.now() - start) < waitMs) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    lastResult = await evaluate();
    attempts++;
  }

  const elapsedMs = Date.now() - start;

  return {
    success: lastResult.passed,
    data: {
      ...lastResult,
      waitMs,
      elapsedMs,
      attempts,
    },
  };
});
