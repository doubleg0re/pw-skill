// browser-resolve.test.ts — resolving a browser request against the registry
import { describe, it, expect } from 'vitest';
import { resolveBrowserSpec, browserSpecFromStored } from '../skills/pw-browse/scripts/browser-resolve.js';

const REG = {
  brave: { path: '/Applications/Brave.app/bin', label: 'Brave', defaultName: 'work' },
  chrome: { path: '/Applications/Chrome.app/bin' },
};
const allExist = () => true;
const noneExist = () => false;

describe('resolveBrowserSpec', () => {
  it('returns null (bundled Chromium) for no request or explicit chromium', () => {
    expect(resolveBrowserSpec({}, { registry: REG, fileExists: allExist })).toBeNull();
    expect(resolveBrowserSpec({ browser: 'chromium' }, { registry: REG, fileExists: allExist })).toBeNull();
  });

  it('resolves a registered name to its binary, carrying label + defaultName', () => {
    expect(resolveBrowserSpec({ browser: 'brave' }, { registry: REG, fileExists: allExist })).toEqual({
      executablePath: '/Applications/Brave.app/bin', channel: undefined, name: 'brave', label: 'Brave', defaultName: 'work',
    });
    const chrome = resolveBrowserSpec({ browser: 'chrome' }, { registry: REG, fileExists: allExist });
    expect(chrome).toMatchObject({ executablePath: '/Applications/Chrome.app/bin', name: 'chrome', label: 'chrome' });
    expect(chrome?.defaultName).toBeUndefined();
  });

  it('lets an explicit --executable win and validates it exists', () => {
    expect(resolveBrowserSpec({ executable: '/opt/brave' }, { registry: REG, fileExists: allExist })).toEqual({
      executablePath: '/opt/brave', channel: undefined, name: '/opt/brave', label: '/opt/brave',
    });
    expect(() => resolveBrowserSpec({ executable: '/nope' }, { registry: REG, fileExists: noneExist })).toThrow(/not found/);
  });

  it('passes a bare --channel straight through', () => {
    expect(resolveBrowserSpec({ channel: 'msedge' }, { registry: REG, fileExists: allExist })).toEqual({
      channel: 'msedge', name: 'channel:msedge', label: 'channel:msedge',
    });
  });

  it('errors for an unregistered name (listing what is registered) or a missing binary', () => {
    expect(() => resolveBrowserSpec({ browser: 'firefox' }, { registry: REG, fileExists: allExist })).toThrow(/not registered/);
    expect(() => resolveBrowserSpec({ browser: 'firefox' }, { registry: REG, fileExists: allExist })).toThrow(/brave, chrome/);
    expect(() => resolveBrowserSpec({ browser: 'brave' }, { registry: REG, fileExists: noneExist })).toThrow(/missing binary/);
  });
});

describe('browserSpecFromStored', () => {
  it('round-trips a registry name, an explicit path, and a channel', () => {
    expect(browserSpecFromStored('brave', { registry: REG })).toEqual({ executablePath: '/Applications/Brave.app/bin' });
    expect(browserSpecFromStored('/opt/brave', { registry: REG })).toEqual({ executablePath: '/opt/brave' });
    expect(browserSpecFromStored('channel:msedge', { registry: REG })).toEqual({ channel: 'msedge' });
  });

  it('returns undefined for empty or unknown ids', () => {
    expect(browserSpecFromStored(undefined, { registry: REG })).toBeUndefined();
    expect(browserSpecFromStored('unknown', { registry: REG })).toBeUndefined();
  });
});
