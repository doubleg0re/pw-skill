// dump.ts — Dump raw DOM/HTML/text from the current page
// Usage:
//   pw dump                                 # document outerHTML
//   pw dump --body                          # body outerHTML
//   pw dump --selector="#app"               # element outerHTML
//   pw dump --selector="#app" --text        # element textContent
//   pw dump --text                          # document textContent
//   pw dump --body --text                   # body textContent
//   pw dump --save=./page.html              # save to file
//   pw dump --save=./page --replace         # overwrite existing
//   pw dump --save=./page --append          # append to existing
import { run, parseFlag, hasFlag } from './common.js';
import { existsSync, writeFileSync, appendFileSync } from 'fs';
import { resolve, extname } from 'path';
import { resolveRedactionLevel } from './settings.js';

const STRICT_CONTENT_LIMIT = 50_000; // ~50KB in strict mode

run(async ({ page }) => {
  const cliArgs = process.argv.slice(2);
  const selector = parseFlag(cliArgs, 'selector');
  const bodyOnly = hasFlag(cliArgs, 'body');
  const textOnly = hasFlag(cliArgs, 'text');
  const savePath = parseFlag(cliArgs, 'save');
  const doReplace = hasFlag(cliArgs, 'replace');
  const doAppend = hasFlag(cliArgs, 'append');
  const redactionLevel = resolveRedactionLevel({
    cliRaw: hasFlag(cliArgs, 'raw'),
    cliLevel: parseFlag(cliArgs, 'redaction-level'),
  });

  // Validate save flags
  if (doReplace && doAppend) {
    return { success: false, error: 'Cannot use --replace and --append together.' };
  }
  if ((doReplace || doAppend) && !savePath) {
    return { success: false, error: '--replace/--append requires --save.' };
  }

  let target: string;
  let format: 'html' | 'text';
  let content: string;

  if (selector) {
    const count = await page.locator(selector).count();
    if (count === 0) {
      return { success: false, error: `No element matched selector: ${selector}` };
    }

    target = `selector:${selector}`;
    const locator = page.locator(selector).first();

    if (textOnly) {
      format = 'text';
      content = (await locator.textContent())?.trim() || '';
    } else {
      format = 'html';
      content = await locator.evaluate(el => el.outerHTML);
    }
  } else if (textOnly) {
    target = bodyOnly ? 'body' : 'document';
    format = 'text';
    content = await page.evaluate((body: boolean) =>
      body
        ? (document.body?.textContent?.trim() || '')
        : (document.documentElement?.textContent?.trim() || ''),
      bodyOnly,
    );
  } else {
    target = bodyOnly ? 'body' : 'document';
    format = 'html';
    content = await page.evaluate((body: boolean) =>
      body
        ? (document.body?.outerHTML || '')
        : (document.documentElement?.outerHTML || ''),
      bodyOnly,
    );
  }

  // File save
  let filePath: string | undefined;
  let mode: 'write' | 'replace' | 'append' = 'write';

  if (savePath) {
    filePath = resolve(savePath);
    if (!extname(filePath)) {
      filePath += format === 'text' ? '.txt' : '.html';
    }

    if (existsSync(filePath)) {
      if (doReplace) {
        mode = 'replace';
      } else if (doAppend) {
        mode = 'append';
      } else {
        return {
          success: false,
          error: `File already exists: ${filePath}\nUse --replace or --append to overwrite.`,
        };
      }
    }

    if (mode === 'append') {
      appendFileSync(filePath, content);
    } else {
      writeFileSync(filePath, content);
    }
  }

  // Apply content limit in strict mode (saves tokens for AI consumers)
  let truncated = false;
  if (redactionLevel === 'strict' && content.length > STRICT_CONTENT_LIMIT && !savePath) {
    content = content.slice(0, STRICT_CONTENT_LIMIT) + '\n...(truncated at 50KB, use --raw for full output)';
    truncated = true;
  }

  return {
    success: true,
    data: {
      target,
      format,
      content,
      ...(truncated ? { truncated: true } : {}),
      ...(filePath ? { path: filePath, mode } : {}),
    },
  };
});
