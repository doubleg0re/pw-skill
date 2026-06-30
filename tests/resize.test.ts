import { describe, expect, it, vi } from 'vitest';
import { actionResize } from '../skills/pw-browse/scripts/actions.js';

describe('actionResize', () => {
  it('resizes the browser window through CDP when available', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Browser.getWindowForTarget') {
        return { windowId: 7 };
      }
      return {};
    });
    const detach = vi.fn().mockResolvedValue(undefined);
    const newCDPSession = vi.fn().mockResolvedValue({ send, detach });
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ width: 16, height: 88 })
      .mockResolvedValueOnce({
        viewport: { width: 1280, height: 720 },
        window: { width: 1296, height: 808 },
      });
    const setViewportSize = vi.fn();
    const context = { newCDPSession };
    const page = {
      context: () => context,
      evaluate,
      setViewportSize,
    } as any;

    const { result } = await actionResize(page, ['1280x720']);

    expect(newCDPSession).toHaveBeenCalledWith(page);
    expect(setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 });
    expect(send).toHaveBeenNthCalledWith(1, 'Emulation.clearDeviceMetricsOverride');
    expect(send).toHaveBeenNthCalledWith(2, 'Emulation.setTouchEmulationEnabled', {
      enabled: false,
      maxTouchPoints: 0,
    });
    expect(send).toHaveBeenNthCalledWith(3, 'Browser.getWindowForTarget');
    expect(send).toHaveBeenNthCalledWith(5, 'Browser.setWindowBounds', {
      windowId: 7,
      bounds: { width: 1296, height: 808 },
    });
    expect(detach).toHaveBeenCalled();
    expect(result).toMatchObject({
      requested: '1280x720',
      width: 1280,
      height: 720,
      mode: 'window',
    });
  });

  it('falls back to viewport resize when window resize is unavailable', async () => {
    const newCDPSession = vi.fn().mockRejectedValue(new Error('no cdp'));
    const setViewportSize = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({
      viewport: { width: 800, height: 600 },
      window: { width: 800, height: 600 },
    });
    const page = {
      context: () => ({ newCDPSession }),
      evaluate,
      setViewportSize,
    } as any;

    const { result } = await actionResize(page, ['800x600']);

    expect(setViewportSize).toHaveBeenCalledWith({ width: 800, height: 600 });
    expect(result).toMatchObject({
      requested: '800x600',
      mode: 'viewport',
    });
  });

  it('rejects invalid sizes', async () => {
    const page = {
      context: () => ({ newCDPSession: vi.fn() }),
      evaluate: vi.fn(),
      setViewportSize: vi.fn(),
    } as any;

    await expect(actionResize(page, ['banana'])).rejects.toThrow('Invalid size "banana"');
  });
});
