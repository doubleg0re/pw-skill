import { devices, type BrowserContextOptions } from 'playwright';

type DeviceDescriptor = BrowserContextOptions & {
  defaultBrowserType?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
};

export interface DevicePreset {
  kind: 'device';
  name: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  defaultBrowserType?: string;
}

function normalizeDeviceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function isDevicePresetDisabled(rawName?: string): boolean {
  if (!rawName) return false;
  return rawName.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'none';
}

function toPreset(name: string, descriptor: DeviceDescriptor | undefined): DevicePreset | null {
  if (!descriptor || !descriptor.viewport) return null;
  return {
    kind: 'device',
    name,
    viewport: descriptor.viewport,
    userAgent: descriptor.userAgent,
    deviceScaleFactor: descriptor.deviceScaleFactor ?? 1,
    isMobile: descriptor.isMobile ?? false,
    hasTouch: descriptor.hasTouch ?? false,
    defaultBrowserType: descriptor.defaultBrowserType,
  };
}

export function findDevicePreset(rawName?: string): DevicePreset | null {
  if (!rawName) return null;

  const cleaned = rawName.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned || isDevicePresetDisabled(cleaned)) return null;

  const exact = toPreset(cleaned, devices[cleaned] as DeviceDescriptor);
  if (exact) return exact;

  const normalized = normalizeDeviceName(cleaned);
  for (const [name, descriptor] of Object.entries(devices)) {
    if (normalizeDeviceName(name) === normalized) {
      return toPreset(name, descriptor as DeviceDescriptor);
    }
  }

  return null;
}

export function resolveDevicePreset(rawName?: string): DevicePreset {
  const preset = findDevicePreset(rawName);
  if (preset) return preset;

  const examples = ['iPhone 12', 'Pixel 5', 'iPad Pro 11'];
  throw new Error(`Unknown device preset "${rawName}". Try one of: ${examples.join(', ')}.`);
}

export function buildDeviceContextOptions(
  preset: DevicePreset,
  viewportOverride?: { width: number; height: number } | null,
): BrowserContextOptions {
  return {
    viewport: viewportOverride ?? preset.viewport,
    userAgent: preset.userAgent,
    deviceScaleFactor: preset.deviceScaleFactor,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
  };
}

export function applyViewportOverride(
  preset: DevicePreset,
  viewportOverride?: { width: number; height: number } | null,
): DevicePreset {
  if (!viewportOverride) return preset;
  return {
    ...preset,
    viewport: viewportOverride,
  };
}

export function getDevicePresetWarning(preset: DevicePreset): string | undefined {
  if (!preset.defaultBrowserType || preset.defaultBrowserType === 'chromium') {
    return undefined;
  }

  return `Device "${preset.name}" defaults to ${preset.defaultBrowserType}, but this CLI keeps using Chromium emulation so extra browser installs are not required.`;
}
