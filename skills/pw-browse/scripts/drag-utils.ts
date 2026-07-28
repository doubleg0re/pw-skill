// drag-utils.ts — pure helpers for `pw drag`: grip anchors, lenient coordinate
// parsing, and box→point resolution. No Playwright imports so it stays unit-testable;
// actions.ts keeps the locator/mouse/boundingBox calls.

/** A rectangle in viewport space, matching Playwright's boundingBox() shape. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where on an element to grab/drop: a named anchor (resolved to fractional
 * offsets) or an explicit pixel offset from the element's top-left.
 */
export type Grip =
  | { kind: 'anchor'; fx: number; fy: number }
  | { kind: 'px'; x: number; y: number };

export const CENTER_GRIP: Grip = { kind: 'anchor', fx: 0.5, fy: 0.5 };

const ANCHOR_TABLE: Record<string, { fx: number; fy: number }> = {
  'top-left': { fx: 0, fy: 0 },
  top: { fx: 0.5, fy: 0 },
  'top-right': { fx: 1, fy: 0 },
  left: { fx: 0, fy: 0.5 },
  center: { fx: 0.5, fy: 0.5 },
  right: { fx: 1, fy: 0.5 },
  'bottom-left': { fx: 0, fy: 1 },
  bottom: { fx: 0.5, fy: 1 },
  'bottom-right': { fx: 1, fy: 1 },
};

/** Anchor names in help/error order. */
export const ANCHOR_NAMES = Object.keys(ANCHOR_TABLE);

/** Named anchor → fractional offsets within the element, or null if unknown. */
export function anchorFractions(anchor: string): { fx: number; fy: number } | null {
  const key = anchor.trim().toLowerCase();
  return ANCHOR_TABLE[key] ?? null;
}

/**
 * Lenient viewport coordinate parser used by drag positionals: allows spaces
 * around the comma and negative/decimal numbers. Rejects anything else (a CSS
 * selector, a bare number, a triple). Kept separate from selector-utils'
 * `isCoordinatePair` so click/dblclick behavior stays unchanged.
 */
export function parseViewportPoint(s: string): { x: number; y: number } | null {
  if (typeof s !== 'string') return null;
  const match = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Parse a --grab/--drop spec: a named anchor or an explicit `x,y` pixel offset. */
export function parseGrip(spec: string): Grip | null {
  const frac = anchorFractions(spec);
  if (frac) return { kind: 'anchor', fx: frac.fx, fy: frac.fy };
  const point = parseViewportPoint(spec);
  if (point) return { kind: 'px', x: point.x, y: point.y };
  return null;
}

/** A grip is "non-center" when it needs an explicit Playwright position. */
export function isNonCenter(grip: Grip): boolean {
  if (grip.kind === 'px') return true;
  return grip.fx !== 0.5 || grip.fy !== 0.5;
}

/**
 * Named edge/corner anchors nudge this many px inside the element. The exact
 * border-box corner sits on the boundary — for a rounded element it's outside
 * the visible shape entirely — so hit-testing there resolves to a parent or
 * sibling and the drag misses (dragTo times out; the mouse path fires on the
 * wrong element). 4px reliably clears typical border-radii (empirically 2px
 * fails, 3px passes on a 10px-radius card; 4px keeps margin). Explicit `x,y`
 * grips are honored literally and never inset.
 */
export const EDGE_INSET_PX = 4;

/** Fractional axis offset → px within `dim`, nudging true edges (0 or 1) inward. */
function insetAxis(frac: number, dim: number): number {
  if (frac === 0) return Math.min(EDGE_INSET_PX, dim / 2);
  if (frac === 1) return Math.max(dim - EDGE_INSET_PX, dim / 2);
  return dim * frac;
}

/** Grip → position relative to the element's top-left (Playwright sourcePosition/targetPosition). */
export function gripToPosition(grip: Grip, box: Box): { x: number; y: number } {
  if (grip.kind === 'px') return { x: grip.x, y: grip.y };
  return { x: insetAxis(grip.fx, box.width), y: insetAxis(grip.fy, box.height) };
}

/** Grip → absolute viewport point (element's box offset + the grip position). */
export function gripToAbsolute(grip: Grip, box: Box): { x: number; y: number } {
  const pos = gripToPosition(grip, box);
  return { x: box.x + pos.x, y: box.y + pos.y };
}
