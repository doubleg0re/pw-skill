// key-utils.ts — Normalize human-written key names into Playwright's vocabulary.
// People type what the keyboard says (cmd+z, esc, down); Playwright wants
// Meta+z, Escape, ArrowDown. Unknown names pass through untouched so the rest of
// Playwright's key vocabulary (Digit1, Semicolon, KeyA, ...) keeps working.

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta', win: 'Meta',
  ctrl: 'Control', control: 'Control',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
};

const KEY_ALIASES: Record<string, string> = {
  enter: 'Enter', return: 'Enter',
  esc: 'Escape', escape: 'Escape',
  tab: 'Tab',
  del: 'Delete', delete: 'Delete',
  backspace: 'Backspace', bs: 'Backspace',
  space: 'Space', spacebar: 'Space',
  up: 'ArrowUp', arrowup: 'ArrowUp',
  down: 'ArrowDown', arrowdown: 'ArrowDown',
  left: 'ArrowLeft', arrowleft: 'ArrowLeft',
  right: 'ArrowRight', arrowright: 'ArrowRight',
  home: 'Home', end: 'End',
  pageup: 'PageUp', pgup: 'PageUp',
  pagedown: 'PageDown', pgdn: 'PageDown',
  insert: 'Insert', ins: 'Insert',
};

function normalizeSegment(part: string): string {
  const lower = part.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase();
  return part;
}

/** "cmd+shift+z" -> "Meta+Shift+z". The last segment is the key, the rest modifiers. */
export function normalizeKey(input: string): string {
  const parts = input.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return input.trim();
  const key = normalizeSegment(parts[parts.length - 1]);
  const modifiers = parts.slice(0, -1).map(m => MODIFIER_ALIASES[m.toLowerCase()] ?? m);
  return [...modifiers, key].join('+');
}
