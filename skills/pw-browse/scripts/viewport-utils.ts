import type { BrowserContext, Page } from 'playwright';
import type { DevicePreset } from './device-presets.js';

export type ViewportSpec = { width: number; height: number } | null;
export type EmulationSpec = ViewportSpec | DevicePreset;

type CdpSession = {
  send(method: string, params?: any): Promise<any>;
  detach?(): Promise<void>;
};

async function withCDPSession<T>(
  page: Page,
  fn: (client: CdpSession) => Promise<T>,
): Promise<T | undefined> {
  if (typeof page.context !== 'function') return undefined;

  const context = page.context() as BrowserContext & {
    newCDPSession?: (page: Page) => Promise<CdpSession>;
  };

  if (typeof context.newCDPSession !== 'function') return undefined;

  let client: CdpSession | null = null;
  try {
    client = await context.newCDPSession(page);
    return await fn(client);
  } catch {
    return undefined;
  } finally {
    await client?.detach?.().catch(() => {});
  }
}

type PageWithBaselineUA = Page & {
  __pwBaselineUserAgent?: string;
};

function isDevicePreset(value: EmulationSpec): value is DevicePreset {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'device';
}

async function getBaselineUserAgent(
  page: PageWithBaselineUA,
  captureIfMissing: boolean = false,
): Promise<string | undefined> {
  if (page.__pwBaselineUserAgent) return page.__pwBaselineUserAgent;

  if (!captureIfMissing || typeof page.evaluate !== 'function') return undefined;

  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
  if (userAgent) {
    page.__pwBaselineUserAgent = userAgent;
  }

  return userAgent;
}

async function clearEmulation(page: PageWithBaselineUA): Promise<void> {
  const baselineUserAgent = await getBaselineUserAgent(page);

  await withCDPSession(page, async client => {
    await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: false,
      maxTouchPoints: 0,
    }).catch(() => {});

    if (baselineUserAgent) {
      await client.send('Network.setUserAgentOverride', {
        userAgent: baselineUserAgent,
      }).catch(() => {});
    }

    return true;
  });
}

export async function applyViewportMode(page: Page, viewport: EmulationSpec): Promise<'auto' | 'fixed' | 'device'> {
  const targetPage = page as PageWithBaselineUA;

  if (viewport === null) {
    await clearEmulation(targetPage);
    return 'auto';
  }

  if (isDevicePreset(viewport)) {
    await getBaselineUserAgent(targetPage, true);
    await page.setViewportSize(viewport.viewport);

    await withCDPSession(page, async client => {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.viewport.width,
        height: viewport.viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.isMobile,
        screenWidth: viewport.viewport.width,
        screenHeight: viewport.viewport.height,
      }).catch(() => {});
      await client.send('Emulation.setTouchEmulationEnabled', {
        enabled: viewport.hasTouch,
        maxTouchPoints: viewport.hasTouch ? 1 : 0,
      }).catch(() => {});

      if (viewport.userAgent) {
        // Applies to subsequent requests, not the already-loaded document —
        // navigate or reload after switching --device for the mobile UA to
        // take effect on the current page.
        await client.send('Network.setUserAgentOverride', {
          userAgent: viewport.userAgent,
        }).catch(() => {});
      }

      return true;
    });

    return 'device';
  }

  await clearEmulation(targetPage);
  await page.setViewportSize(viewport);
  return 'fixed';
}

export async function resizeBrowserWindow(page: Page, size: { width: number; height: number }): Promise<boolean> {
  const result = await withCDPSession(page, async client => {
    const frameDelta = await page.evaluate(() => ({
      width: Math.max(0, window.outerWidth - window.innerWidth),
      height: Math.max(0, window.outerHeight - window.innerHeight),
    })).catch(() => ({ width: 0, height: 0 }));

    const { windowId } = await client.send('Browser.getWindowForTarget');
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    }).catch(() => {});
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        width: size.width + frameDelta.width,
        height: size.height + frameDelta.height,
      },
    });
    return true;
  });

  return result === true;
}
