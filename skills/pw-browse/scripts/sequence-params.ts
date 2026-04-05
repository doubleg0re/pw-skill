// sequence-params.ts — step normalization + `--params` loading helpers for
// the sequence flow engine.
//
// Extracted from sequence.ts as part of the Phase 1 refactor
// (.claude/docs/sequence-refactor.md). Behavior is intentionally unchanged.
//
// `loadParams` depends on VarStore from sequence-engine.ts (Phase 2). It
// only uses VarStore#set through an existing instance, never instantiating
// one, so the import is type-only and there is no runtime cycle.

import { existsSync, readFileSync } from 'fs';
import type { VarStore } from './sequence-engine.js';

// --- Step shorthand normalization ---

// Keys that indicate an explicit step (not shorthand)
const EXPLICIT_STEP_KEYS = new Set([
  'action', 'comment', 'condition', 'each', 'loop', 'try', 'def', 'call',
  'shell', 'return', 'set', 'log',
]);

/**
 * Normalize a shorthand step into explicit form.
 *
 * Shorthand: { "navigate": "https://example.com" }
 *        or: { "fill": ["#email", "test@test.com"] }
 * Explicit:  { "action": "navigate", "args": ["https://example.com"] }
 *
 * Rules:
 * - Must be a single-key object (excluding "comment")
 * - Key must not be an explicit step key
 * - Value becomes args (wrapped in array if not already)
 * - Multi-key objects with shorthand + metadata are rejected
 */
export function normalizeStep(step: any): any {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step;

  // Already explicit form
  const keys = Object.keys(step);
  if (keys.some(k => EXPLICIT_STEP_KEYS.has(k))) return step;

  // Comment-only step
  if (keys.length === 1 && keys[0] === 'comment') return step;

  // Filter out comment key for shorthand detection
  const nonCommentKeys = keys.filter(k => k !== 'comment');

  if (nonCommentKeys.length === 0) return step;

  if (nonCommentKeys.length === 1) {
    const actionName = nonCommentKeys[0];
    const value = step[actionName];
    // Array → use as positional args
    // Plain object → use as named args (ActionArgs Record style)
    // Primitive → wrap as single-element array
    let args: any;
    if (Array.isArray(value)) {
      args = value;
    } else if (value !== null && typeof value === 'object') {
      args = value; // named object args — pass through as-is
    } else {
      args = [value]; // string, number, etc → positional
    }
    return { action: actionName, args };
  }

  // Multiple non-comment, non-explicit keys → ambiguous, reject
  // (could be shorthand + metadata, which is not allowed)
  return step;
}

// --- Params loading ---

const FORBIDDEN_PARAM_KEYS = new Set([
  'action', 'def', 'call', 'condition', 'each', 'loop', 'try', 'catch',
  'finally', 'shell', 'return', 'flow', 'items', 'comment',
]);

/** Load params from JSON string or file path into VarStore. Returns error string or null. */
export function loadParams(vars: VarStore, paramsArg: string): string | null {
  let data: Record<string, any>;
  try {
    if (existsSync(paramsArg)) {
      data = JSON.parse(readFileSync(paramsArg, 'utf-8'));
    } else {
      data = JSON.parse(paramsArg);
    }
  } catch {
    return `Invalid --params: not valid JSON or file not found.`;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return `--params must be a JSON object, not ${Array.isArray(data) ? 'array' : typeof data}.`;
  }

  // Check forbidden keys
  const forbidden = Object.keys(data).filter(k => FORBIDDEN_PARAM_KEYS.has(k));
  if (forbidden.length > 0) {
    return `--params contains forbidden keys: ${forbidden.join(', ')}. Params are data-only.`;
  }

  // Load referenced param files ($id and load are metadata, skip them)
  for (const [key, value] of Object.entries(data)) {
    if (key === '$id' || key === 'load') continue;
    vars.set(key, value);
  }

  // Handle "load" — merge additional param files
  if (Array.isArray(data.load)) {
    for (const loadPath of data.load) {
      if (typeof loadPath !== 'string') continue;
      const subError = loadParams(vars, loadPath);
      if (subError) return subError;
    }
  }

  return null;
}
