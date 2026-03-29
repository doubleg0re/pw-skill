import { describe, it, expect, vi } from 'vitest';
import { buildRuntime, type ExtensionRuntimeContext } from '../skills/pw-browse/scripts/runtime.js';

function fakeSession(overrides: any = {}) {
  return {
    id: 'test-id',
    name: 'test-session',
    port: 9222,
    pid: process.pid,
    wsEndpoint: '',
    cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc',
    startedAt: new Date().toISOString(),
    video: null,
    ...overrides,
  };
}

describe('buildRuntime — context shape', () => {
  it('has all required fields', () => {
    const runtime = buildRuntime({ session: fakeSession() });
    expect(runtime.session.name).toBe('test-session');
    expect(runtime.session.cdpEndpoint).toContain('9222');
    expect(typeof runtime.emitEvent).toBe('function');
    expect(typeof runtime.registerCleanup).toBe('function');
    expect(typeof runtime.logger.info).toBe('function');
    expect(typeof runtime.logger.warn).toBe('function');
    expect(typeof runtime.logger.error).toBe('function');
  });

  it('lazy accessors return provided objects', async () => {
    const fakePage = { url: () => 'http://test.com' };
    const runtime = buildRuntime({ session: fakeSession(), page: fakePage });
    expect(await runtime.getBrowser?.()).toBeUndefined();
    expect(await runtime.getPage?.()).toBe(fakePage);
  });

  it('tab info from page', () => {
    const runtime = buildRuntime({
      session: fakeSession(),
      page: { url: () => 'http://example.com' },
    });
    expect(runtime.tab?.url).toBe('http://example.com');
  });

  it('no tab when no page', () => {
    const runtime = buildRuntime({ session: fakeSession() });
    expect(runtime.tab).toBeUndefined();
  });
});

describe('buildRuntime — emitEvent', () => {
  it('calls matching handler', () => {
    const handler = vi.fn();
    const runtime = buildRuntime({
      session: fakeSession(),
      eventHandlers: [{ event: 'tab:navigated', packageName: 'test', fn: handler }],
    });

    runtime.emitEvent('tab:navigated', { url: 'http://test.com' });
    expect(handler).toHaveBeenCalledWith({ url: 'http://test.com' });
  });

  it('does not call non-matching handler', () => {
    const handler = vi.fn();
    const runtime = buildRuntime({
      session: fakeSession(),
      eventHandlers: [{ event: 'tab:closed', packageName: 'test', fn: handler }],
    });

    runtime.emitEvent('tab:navigated', { url: 'http://test.com' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler error does not throw', () => {
    const runtime = buildRuntime({
      session: fakeSession(),
      eventHandlers: [{
        event: 'test',
        packageName: 'bad',
        fn: () => { throw new Error('boom'); },
      }],
    });

    expect(() => runtime.emitEvent('test', {})).not.toThrow();
  });

  it('async handler error does not throw', async () => {
    const runtime = buildRuntime({
      session: fakeSession(),
      eventHandlers: [{
        event: 'test',
        packageName: 'bad',
        fn: async () => { throw new Error('async boom'); },
      }],
    });

    expect(() => runtime.emitEvent('test', {})).not.toThrow();
    // Give async handler time to settle
    await new Promise(r => setTimeout(r, 50));
  });

  it('multiple handlers for same event all called', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const runtime = buildRuntime({
      session: fakeSession(),
      eventHandlers: [
        { event: 'test', packageName: 'a', fn: h1 },
        { event: 'test', packageName: 'b', fn: h2 },
      ],
    });

    runtime.emitEvent('test', { data: 1 });
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });
});

describe('buildRuntime — registerCleanup', () => {
  it('accepts cleanup functions', () => {
    const runtime = buildRuntime({ session: fakeSession() });
    expect(() => runtime.registerCleanup(() => {})).not.toThrow();
    expect(() => runtime.registerCleanup(async () => {})).not.toThrow();
  });
});
