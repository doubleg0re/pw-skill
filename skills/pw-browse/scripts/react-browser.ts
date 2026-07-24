// react-browser.ts — Browser-side React inspection tools.
//
// `reactBrowser` is never executed in Node; react.ts injects it into the page via
// Function.prototype.toString() (wrapped by wrapInjectable) and calls it there,
// passing the (also-injected) buildFiberChain so runtime and tests share one walk.
//
// Keep reactBrowser fully self-contained: reference only its parameter, its own
// inner functions, and browser globals — no imports, no outer-scope bindings.

declare const document: any;
declare const window: any;

// esbuild's keep-names transform sprinkles `__name(...)` calls through any
// stringified function. Wrap injected source in an IIFE that provides a no-op
// `__name`, so the source is standalone in the page (which has no such helper).
export function wrapInjectable(src: string): string {
  return `(function(){var __name=function(f){return f;};return (${src});})()`;
}

export function reactBrowser(buildFiberChain: any) {
  const getFiber = (node: any) => {
    for (let n = node; n; n = n.parentElement) {
      const k = Object.keys(n).find(x => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
      if (k) return n[k];
    }
    return null;
  };

  const cssSelector = (node: any) => {
    const tag = node.tagName.toLowerCase();
    if (node.id) return `${tag}#${node.id}`;
    const cls = [...node.classList].find(Boolean);
    return cls ? `${tag}.${cls}` : tag;
  };

  const capture = (node: any) => {
    const chain = buildFiberChain(getFiber(node), { limit: 40 });
    return {
      component: (chain.find((c: any) => c.kind === 'component') || {}).name || null,
      selector: cssSelector(node),
      text: (node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      source: (chain.find((c: any) => c.source) || {}).source || null,
      chain,
    };
  };

  return {
    inspect(selector: string, depth: number) {
      const el = document.querySelector(selector);
      if (!el) return { error: 'no element matches selector' };
      const fiber = getFiber(el);
      if (!fiber) return { error: 'element is not React-managed (no fiber found)' };
      return { tag: el.tagName.toLowerCase(), chain: buildFiberChain(fiber, { limit: depth }) };
    },

    installPicker() {
      const existing = window.__componentPick;
      if (existing) { existing.destroy(); return { active: false, toggledOff: true }; }

      const mk = (tag: string, css: string, text?: string) => {
        const n = document.createElement(tag);
        if (css) n.style.cssText = css;
        if (text != null) n.textContent = text;
        return n;
      };
      const box = mk('div', 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:3px;display:none;box-sizing:border-box');
      const label = mk('div', 'position:absolute;left:0;top:-24px;padding:3px 7px;border-radius:4px;background:#2563eb;color:#fff;font:12px system-ui;white-space:nowrap');
      box.appendChild(label);
      const panel = mk('div', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:280px;padding:12px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#111;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.18)');
      const info = mk('div', 'margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px', 'Hover a component. Click to capture (Ctrl/Cmd/Shift adds). Esc closes.');
      panel.append(mk('div', 'font-weight:700;margin-bottom:6px', 'React Picker'), info);

      const captures: any[] = [];
      const render = (node: any) => {
        const r = node.getBoundingClientRect();
        const c = capture(node);
        box.style.display = 'block';
        box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
        box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
        label.textContent = `${c.component || c.selector} · ${Math.round(r.width)}x${Math.round(r.height)}`;
      };
      const onMove = (e: any) => { if (panel.contains(e.target)) return; render(e.target); };
      const onClick = (e: any) => {
        if (panel.contains(e.target)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) captures.length = 0;
        const c = capture(e.target);
        captures.push(c);
        const handlers = (c.chain.find((x: any) => x.handlers.length) || {}).handlers || [];
        info.textContent = `Captured ${captures.length}: ${c.component || c.selector}${c.source ? '\n' + c.source : ''}\nhandlers: ${handlers.join(', ') || '-'}`;
      };
      const onKey = (e: any) => { if (e.key === 'Escape') destroy(); };
      const destroy = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        box.remove(); panel.remove();
        delete window.__componentPick;
      };
      document.body.append(box, panel);
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      window.__componentPick = { destroy, captures };
      return { active: true, toggledOff: false };
    },

    readPicks(clear: boolean) {
      const store = window.__componentPick;
      const captures = store && store.captures ? store.captures.slice() : [];
      if (clear && store) store.captures.length = 0;
      return { active: !!store, count: captures.length, captures };
    },
  };
}
