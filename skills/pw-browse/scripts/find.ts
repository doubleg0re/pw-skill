// find.ts — DOM element search
// Usage:
//   pw find ".item"                          # matching element count + text
//   pw find "#form" --children               # child element list
//   pw find ".card" --detail=tag             # tag name only
//   pw find ".card" --detail=class           # tag + class
//   pw find ".card" --detail=full            # tag + id + class + text + attributes
//   pw find ".card" --attr=data-id           # extract specific attribute values only
//   pw find ".card" --limit=5               # max N elements
import { run, parseFlag, hasFlag } from './common.js';

type DetailLevel = 'tag' | 'class' | 'full';

run(async ({ page, args }) => {
  const selector = args[0];
  if (!selector) return { success: false, error: 'Usage: find.ts <selector> [--children] [--detail=tag|class|full] [--attr=name] [--limit=n]' };

  const children = hasFlag(process.argv.slice(2), 'children');
  const detail = (parseFlag(process.argv.slice(2), 'detail') || 'class') as DetailLevel;
  const attrName = parseFlag(process.argv.slice(2), 'attr');
  const limitStr = parseFlag(process.argv.slice(2), 'limit');
  const limit = limitStr ? parseInt(limitStr) : 20;

  // Extract specific attribute values only
  if (attrName) {
    const values = await page.locator(selector).evaluateAll(
      (els, { attr, limit }) => els.slice(0, limit).map(el => ({
        value: el.getAttribute(attr),
        text: el.textContent?.trim().substring(0, 50) || '',
      })),
      { attr: attrName, limit },
    );
    return { success: true, data: { selector, attr: attrName, count: values.length, values } };
  }

  // Search child elements
  const targetSelector = children ? `${selector} > *` : selector;

  const elements = await page.locator(targetSelector).evaluateAll(
    (els, { detail, limit }) => els.slice(0, limit).map((el, i) => {
      const base: any = { index: i, tag: el.tagName.toLowerCase() };

      if (detail === 'tag') return base;

      base.id = el.id || undefined;
      base.class = el.className || undefined;

      if (detail === 'class') {
        base.text = el.textContent?.trim().substring(0, 80) || undefined;
        return base;
      }

      // full
      base.text = el.textContent?.trim().substring(0, 120) || undefined;
      const attrs: Record<string, string> = {};
      for (const a of el.attributes) {
        if (!['id', 'class', 'style'].includes(a.name)) {
          attrs[a.name] = a.value.substring(0, 100);
        }
      }
      if (Object.keys(attrs).length) base.attrs = attrs;
      base.childCount = el.children.length;

      return base;
    }),
    { detail, limit },
  );

  const total = await page.locator(targetSelector).count();

  return {
    success: true,
    data: {
      selector: targetSelector,
      total,
      showing: elements.length,
      elements,
    },
  };
});
