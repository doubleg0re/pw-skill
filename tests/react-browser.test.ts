import { describe, expect, it } from 'vitest';
import { wrapInjectable, reactBrowser } from '../skills/pw-browse/scripts/react-browser.js';
import { buildFiberChain } from '../skills/pw-browse/scripts/react-fiber.js';

describe('wrapInjectable', () => {
  it('provides a no-op __name shim so esbuild keep-names calls resolve in the page', () => {
    const wrapped = wrapInjectable('function f(){ return __name(function g(){}, "g"); }');
    // The shim must define __name; eval must not throw ReferenceError.
    expect(wrapped).toContain('var __name');
    const fn = (0, eval)(wrapped);
    expect(typeof fn).toBe('function');
    expect(typeof fn()).toBe('function'); // inner __name(...) call resolved
  });

  it('injected reactBrowser factory builds usable tools when eval-ed with buildFiberChain', () => {
    const chain = (0, eval)(wrapInjectable(buildFiberChain.toString()));
    const tools = (0, eval)(wrapInjectable(reactBrowser.toString()))(chain);
    expect(typeof tools.inspect).toBe('function');
    expect(typeof tools.installPicker).toBe('function');
    expect(typeof tools.readPicks).toBe('function');
  });
});
