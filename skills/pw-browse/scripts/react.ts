// react.ts — Inspect the React fiber tree of a live page (dev tool).
// Usage:
//   pw react <selector>          # dump component chain + handlers + source for one element
//   pw react <selector> --limit=n
//   pw react --pick              # inject a hover/click inspector overlay (needs --headed session)
//   pw react --pick-result [--clear]   # read what the overlay captured
//
// The fiber walk (react-fiber.ts) and browser tools (react-browser.ts) are unit-
// tested in Node and injected into the page here via toString(), so runtime and
// tests share one implementation. Outer page.evaluate callbacks stay free of named
// inner functions so esbuild's `__name` helper never leaks into the page.
import { run, parseFlag, hasFlag } from './common.js';
import { buildFiberChain } from './react-fiber.js';
import { reactBrowser, wrapInjectable } from './react-browser.js';

const CHAIN_SRC = wrapInjectable(buildFiberChain.toString());
const TOOLS_SRC = wrapInjectable(reactBrowser.toString());

run(async ({ page, args }) => {
  const rawArgs = process.argv.slice(2);

  if (hasFlag(rawArgs, 'pick-result')) {
    const data = await page.evaluate(({ chainSrc, toolsSrc, doClear }) => {
      const tools = (0, eval)(toolsSrc)((0, eval)(chainSrc));
      return tools.readPicks(doClear);
    }, { chainSrc: CHAIN_SRC, toolsSrc: TOOLS_SRC, doClear: hasFlag(rawArgs, 'clear') });
    return { success: true, data };
  }

  if (hasFlag(rawArgs, 'pick')) {
    const data = await page.evaluate(({ chainSrc, toolsSrc }) => {
      const tools = (0, eval)(toolsSrc)((0, eval)(chainSrc));
      return tools.installPicker();
    }, { chainSrc: CHAIN_SRC, toolsSrc: TOOLS_SRC });
    return {
      success: true,
      data: {
        ...data,
        hint: data.active
          ? 'Hover/click elements in the browser, then run `pw react --pick-result`. Re-run `pw react --pick` or press Esc to stop.'
          : 'Picker turned off.',
      },
    };
  }

  const selector = args[0];
  if (!selector) {
    return { success: false, error: 'Usage: pw react <selector> [--limit=n] | pw react --pick | pw react --pick-result [--clear]' };
  }
  const limitStr = parseFlag(rawArgs, 'limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 40;

  const data = await page.evaluate(({ chainSrc, toolsSrc, sel, depth }) => {
    const tools = (0, eval)(toolsSrc)((0, eval)(chainSrc));
    return tools.inspect(sel, depth);
  }, { chainSrc: CHAIN_SRC, toolsSrc: TOOLS_SRC, sel: selector, depth: limit });

  if ((data as any).error) return { success: false, error: (data as any).error, data: { selector } };

  const chain = (data as any).chain as any[];
  const note = chain.length && !chain.some(n => n.source)
    ? 'No _debugSource — source file:line unavailable (common in Next.js/SWC dev, or any production build). Component names above are still valid; minified single-letter names indicate a production build.'
    : undefined;

  return { success: true, data: { selector, tag: (data as any).tag, count: chain.length, chain, ...(note ? { note } : {}) } };
});
