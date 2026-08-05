// browser-resolve.test.ts — mapping a browser request to launch options
import { describe, it, expect } from 'vitest';
import { resolveBrowserSpec, MAC_BROWSER_PATHS } from '../skills/pw-browse/scripts/browser-resolve.js';

const allExist = () => true;
const noneExist = () => false;

describe('resolveBrowserSpec', () => {
  it('returns null (bundled Chromium) for no request or explicit chromium', () => {
    expect(resolveBrowserSpec({}, allExist)).toBeNull();
    expect(resolveBrowserSpec({ browser: 'chromium' }, allExist)).toBeNull();
    expect(resolveBrowserSpec({ browser: 'Chromium' }, allExist)).toBeNull();
  });

  it('maps known browser names to the macOS app binary', () => {
    expect(resolveBrowserSpec({ browser: 'brave' }, allExist)).toEqual({
      executablePath: MAC_BROWSER_PATHS.brave.path,
      channel: undefined,
      label: 'Brave',
    });
    expect(resolveBrowserSpec({ browser: 'chrome' }, allExist)?.label).toBe('Chrome');
    expect(resolveBrowserSpec({ browser: 'EDGE' }, allExist)?.label).toBe('Edge');
  });

  it('lets an explicit --executable win and validates it exists', () => {
    expect(resolveBrowserSpec({ executable: '/opt/my/brave' }, allExist)).toEqual({
      executablePath: '/opt/my/brave',
      channel: undefined,
      label: '/opt/my/brave',
    });
    expect(() => resolveBrowserSpec({ executable: '/nope' }, noneExist)).toThrow(/not found/);
  });

  it('passes a bare --channel straight through', () => {
    expect(resolveBrowserSpec({ channel: 'msedge' }, allExist)).toEqual({
      channel: 'msedge',
      label: 'channel:msedge',
    });
  });

  it('throws a helpful error for an unknown browser or a missing install', () => {
    expect(() => resolveBrowserSpec({ browser: 'firefox' }, allExist)).toThrow(/Unknown --browser/);
    expect(() => resolveBrowserSpec({ browser: 'brave' }, noneExist)).toThrow(/Brave not found/);
  });
});
