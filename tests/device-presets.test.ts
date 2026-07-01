// device-presets.test.ts — Playwright device preset resolution for --device.
import { describe, it, expect } from 'vitest';
import {
  isDevicePresetDisabled,
  findDevicePreset,
  resolveDevicePreset,
  buildDeviceContextOptions,
  applyViewportOverride,
  getDevicePresetWarning,
} from '../skills/pw-browse/scripts/device-presets.js';

describe('isDevicePresetDisabled', () => {
  it('treats "none" (any case, quoted, padded) as disabled', () => {
    expect(isDevicePresetDisabled('none')).toBe(true);
    expect(isDevicePresetDisabled('None')).toBe(true);
    expect(isDevicePresetDisabled('  none  ')).toBe(true);
    expect(isDevicePresetDisabled('"none"')).toBe(true);
  });
  it('is false for a real device or empty input', () => {
    expect(isDevicePresetDisabled('iPhone 12')).toBe(false);
    expect(isDevicePresetDisabled(undefined)).toBe(false);
  });
});

describe('findDevicePreset', () => {
  it('resolves an exact device name to a full preset', () => {
    const p = findDevicePreset('iPhone 12');
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('device');
    expect(p!.name).toBe('iPhone 12');
    expect(p!.viewport.width).toBeGreaterThan(0);
    expect(p!.isMobile).toBe(true);
    expect(p!.hasTouch).toBe(true);
    expect(p!.deviceScaleFactor).toBeGreaterThan(1);
  });
  it('matches case- and separator-insensitively', () => {
    expect(findDevicePreset('iphone12')?.name).toBe('iPhone 12');
    expect(findDevicePreset("'iPhone 12'")?.name).toBe('iPhone 12');
  });
  it('returns null for unknown, disabled, or empty names', () => {
    expect(findDevicePreset('No Such Device 9000')).toBeNull();
    expect(findDevicePreset('none')).toBeNull();
    expect(findDevicePreset(undefined)).toBeNull();
  });
});

describe('resolveDevicePreset', () => {
  it('returns the preset for a known device', () => {
    expect(resolveDevicePreset('Pixel 5').name).toBe('Pixel 5');
  });
  it('throws a helpful error for an unknown device', () => {
    expect(() => resolveDevicePreset('No Such Device 9000')).toThrow(/Unknown device preset/);
  });
});

describe('applyViewportOverride / buildDeviceContextOptions (--device + --viewport)', () => {
  it('overrides only the viewport, preserving UA/DPR/mobile/touch', () => {
    const base = resolveDevicePreset('iPhone 12');
    const overridden = applyViewportOverride(base, { width: 500, height: 900 });
    expect(overridden.viewport).toEqual({ width: 500, height: 900 });
    expect(overridden.userAgent).toBe(base.userAgent);
    expect(overridden.deviceScaleFactor).toBe(base.deviceScaleFactor);
    expect(overridden.isMobile).toBe(base.isMobile);
  });
  it('returns the same preset when no override is given', () => {
    const base = resolveDevicePreset('iPhone 12');
    expect(applyViewportOverride(base, null)).toBe(base);
  });
  it('builds context options from the preset', () => {
    const p = resolveDevicePreset('iPhone 12');
    const opts = buildDeviceContextOptions(p);
    expect(opts.viewport).toEqual(p.viewport);
    expect(opts.isMobile).toBe(true);
    expect(opts.hasTouch).toBe(true);
    const opts2 = buildDeviceContextOptions(p, { width: 800, height: 600 });
    expect(opts2.viewport).toEqual({ width: 800, height: 600 });
  });
});

describe('getDevicePresetWarning', () => {
  it('warns when a device defaults to a non-chromium browser', () => {
    // iPhone devices default to webkit; the CLI still uses chromium emulation.
    const warning = getDevicePresetWarning(resolveDevicePreset('iPhone 12'));
    expect(warning).toMatch(/Chromium/);
  });
  it('is silent for a chromium-default device', () => {
    expect(getDevicePresetWarning(resolveDevicePreset('Pixel 5'))).toBeUndefined();
  });
});
