// find.ts — DOM 요소 탐색
// Usage:
//   pw find ".item"                          # 매칭 요소 개수 + 텍스트
//   pw find "#form" --children               # 자식 요소 목록
//   pw find ".card" --detail=tag             # 태그명만
//   pw find ".card" --detail=class           # 태그 + 클래스
//   pw find ".card" --detail=full            # 태그 + id + 클래스 + 텍스트 + 속성
//   pw find ".card" --attr=data-id           # 특정 속성값만 추출
//   pw find ".card" --limit=5               # 최대 N개
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

  // 특정 속성값만 추출
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

  // 자식 요소 탐색
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
