// drag-utils.test.ts — pure grip/coordinate helpers for `pw drag`
import { describe, it, expect } from 'vitest';
import {
  anchorFractions,
  parseGrip,
  parseViewportPoint,
  gripToPosition,
  gripToAbsolute,
  isNonCenter,
  CENTER_GRIP,
  type Grip,
} from '../skills/pw-browse/scripts/drag-utils.js';

describe('anchorFractions', () => {
  it('maps every named anchor to its fractional offset', () => {
    expect(anchorFractions('top-left')).toEqual({ fx: 0, fy: 0 });
    expect(anchorFractions('top')).toEqual({ fx: 0.5, fy: 0 });
    expect(anchorFractions('top-right')).toEqual({ fx: 1, fy: 0 });
    expect(anchorFractions('left')).toEqual({ fx: 0, fy: 0.5 });
    expect(anchorFractions('center')).toEqual({ fx: 0.5, fy: 0.5 });
    expect(anchorFractions('right')).toEqual({ fx: 1, fy: 0.5 });
    expect(anchorFractions('bottom-left')).toEqual({ fx: 0, fy: 1 });
    expect(anchorFractions('bottom')).toEqual({ fx: 0.5, fy: 1 });
    expect(anchorFractions('bottom-right')).toEqual({ fx: 1, fy: 1 });
  });

  it('is case/space tolerant', () => {
    expect(anchorFractions(' Top-Left ')).toEqual({ fx: 0, fy: 0 });
    expect(anchorFractions('CENTER')).toEqual({ fx: 0.5, fy: 0.5 });
  });

  it('returns null for non-anchors', () => {
    expect(anchorFractions('middle')).toBeNull();
    expect(anchorFractions('0,0')).toBeNull();
    expect(anchorFractions('')).toBeNull();
  });
});

describe('parseViewportPoint', () => {
  it('parses lenient coordinate pairs', () => {
    expect(parseViewportPoint('100,200')).toEqual({ x: 100, y: 200 });
    expect(parseViewportPoint('100, 200')).toEqual({ x: 100, y: 200 });
    expect(parseViewportPoint(' 100 , 200 ')).toEqual({ x: 100, y: 200 });
    expect(parseViewportPoint('-5,10')).toEqual({ x: -5, y: 10 });
    expect(parseViewportPoint('12.5,4')).toEqual({ x: 12.5, y: 4 });
  });

  it('rejects non-coordinates', () => {
    expect(parseViewportPoint('abc')).toBeNull();
    expect(parseViewportPoint('.card')).toBeNull();
    expect(parseViewportPoint('100')).toBeNull();
    expect(parseViewportPoint('100,200,10')).toBeNull();
    expect(parseViewportPoint('')).toBeNull();
  });
});

describe('parseGrip', () => {
  it('parses named anchors', () => {
    expect(parseGrip('center')).toEqual({ kind: 'anchor', fx: 0.5, fy: 0.5 });
    expect(parseGrip('top-left')).toEqual({ kind: 'anchor', fx: 0, fy: 0 });
    expect(parseGrip('bottom-right')).toEqual({ kind: 'anchor', fx: 1, fy: 1 });
  });

  it('parses explicit pixel offsets', () => {
    expect(parseGrip('10,20')).toEqual({ kind: 'px', x: 10, y: 20 });
    expect(parseGrip('10, 20')).toEqual({ kind: 'px', x: 10, y: 20 });
    expect(parseGrip('-3,4.5')).toEqual({ kind: 'px', x: -3, y: 4.5 });
  });

  it('returns null for garbage', () => {
    expect(parseGrip('nope')).toBeNull();
    expect(parseGrip('.card')).toBeNull();
    expect(parseGrip('')).toBeNull();
  });
});

describe('grip resolution against a fake box', () => {
  // 200x100 box at (50,30)
  const box = { x: 50, y: 30, width: 200, height: 100 };

  it('resolves center to element-relative position and absolute point', () => {
    const grip = parseGrip('center')!;
    expect(gripToPosition(grip, box)).toEqual({ x: 100, y: 50 });
    expect(gripToAbsolute(grip, box)).toEqual({ x: 150, y: 80 });
  });

  it('resolves top-left with a 4px edge inset (exact corner mis-hits parent/rounded shape)', () => {
    const grip = parseGrip('top-left')!;
    expect(gripToPosition(grip, box)).toEqual({ x: 4, y: 4 });
    expect(gripToAbsolute(grip, box)).toEqual({ x: 54, y: 34 });
  });

  it('resolves bottom-right with the edge inset on both axes', () => {
    const grip = parseGrip('bottom-right')!;
    expect(gripToPosition(grip, box)).toEqual({ x: 196, y: 96 });
    expect(gripToAbsolute(grip, box)).toEqual({ x: 246, y: 126 });
  });

  it('insets only true edges — a mid-edge anchor keeps its centered axis exact', () => {
    // 'top' = fx 0.5 (exact center X), fy 0 (inset Y)
    expect(gripToPosition(parseGrip('top')!, box)).toEqual({ x: 100, y: 4 });
    // 'right' = fx 1 (inset X), fy 0.5 (exact center Y)
    expect(gripToPosition(parseGrip('right')!, box)).toEqual({ x: 196, y: 50 });
  });

  it('clamps the inset to the box center for tiny elements', () => {
    const tiny = { x: 0, y: 0, width: 6, height: 6 };
    expect(gripToPosition(parseGrip('top-left')!, tiny)).toEqual({ x: 3, y: 3 });
    expect(gripToPosition(parseGrip('bottom-right')!, tiny)).toEqual({ x: 3, y: 3 });
  });

  it('passes explicit px offsets through unchanged — never inset', () => {
    const grip = parseGrip('10,20')!;
    expect(gripToPosition(grip, box)).toEqual({ x: 10, y: 20 });
    expect(gripToAbsolute(grip, box)).toEqual({ x: 60, y: 50 });
    // literal corner stays literal
    expect(gripToPosition(parseGrip('0,0')!, box)).toEqual({ x: 0, y: 0 });
  });
});

describe('isNonCenter', () => {
  it('is false only for the center anchor', () => {
    expect(isNonCenter(CENTER_GRIP)).toBe(false);
    expect(isNonCenter({ kind: 'anchor', fx: 0.5, fy: 0.5 })).toBe(false);
  });

  it('is true for off-center anchors and any pixel offset', () => {
    expect(isNonCenter({ kind: 'anchor', fx: 0, fy: 0 })).toBe(true);
    expect(isNonCenter({ kind: 'anchor', fx: 0.5, fy: 1 })).toBe(true);
    expect(isNonCenter({ kind: 'px', x: 0, y: 0 } as Grip)).toBe(true);
  });
});
