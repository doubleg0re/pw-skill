import { describe, expect, it, vi } from 'vitest';
import { applyViewportMode, resizeBrowserWindow } from '../skills/pw-browse/scripts/viewport-utils.js';

describe('applyViewportMode', () => {
  it('sets a fixed viewport through Playwright when a size is given', async () => {
    const page = {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mode = await applyViewportMode(page, { width: 1440, height: 900 });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1440, height: 900 });
    expect(mode).toBe('fixed');
  });

  it('clears device metrics override for auto viewport', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue({ send, detach }) }),
      setViewportSize: vi.fn(),
    } as any;

    const mode = await applyViewportMode(page, null);

    expect(send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride');
    expect(detach).toHaveBeenCalled();
    expect(mode).toBe('auto');
  });

  it('applies device metrics, touch, and user agent for device presets', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue({ send, detach }) }),
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('Desktop UA'),
    } as any;

    const mode = await applyViewportMode(page, {
      kind: 'device',
      name: 'iPhone 12',
      viewport: { width: 390, height: 844 },
      userAgent: 'Mobile UA',
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      defaultBrowserType: 'webkit',
    });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 });
    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({
      width: 390,
      height: 844,
      mobile: true,
      deviceScaleFactor: 3,
    }));
    expect(send).toHaveBeenCalledWith('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    expect(send).toHaveBeenCalledWith('Network.setUserAgentOverride', {
      userAgent: 'Mobile UA',
    });
    expect(mode).toBe('device');
  });
});

describe('resizeBrowserWindow', () => {
  it('returns false when CDP window control is unavailable', async () => {
    const page = {
      context: () => ({}),
    } as any;

    await expect(resizeBrowserWindow(page, { width: 1200, height: 800 })).resolves.toBe(false);
  });
});
