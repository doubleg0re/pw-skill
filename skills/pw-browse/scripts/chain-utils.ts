// chain-utils.ts — Shared helpers for :: chaining, dialog handling, and inline $ret references
import type { Dialog } from 'playwright';

export function isChainReference(value: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(value);
}

function getPath(root: any, path: string): any {
  const parts = path.split('.');
  let current = root;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = current[part];
    }
  }
  return current;
}

export function normalizeChainReference(value: any): any {
  if (typeof value !== 'string') return value;
  if (!isChainReference(value)) return value;
  return `{{${value}}}`;
}

export function resolveInlineReference(value: any, scope: Record<string, any>): any {
  if (typeof value !== 'string') return value;
  if (!isChainReference(value)) return value;
  return getPath(scope, value);
}

export function buildChainStepArgs(args: string[]): any {
  const hasFlags = args.some(a => a.startsWith('--'));
  if (!hasFlags) return args.map(normalizeChainReference);

  const result: Record<string, any> = {};
  let idx = 0;
  for (const a of args) {
    if (a.startsWith('--')) {
      const eqIndex = a.indexOf('=');
      if (eqIndex > 0) {
        result[a.slice(2, eqIndex)] = normalizeChainReference(a.slice(eqIndex + 1));
      } else {
        result[a.slice(2)] = true;
      }
    } else {
      result[idx] = normalizeChainReference(a);
      idx++;
    }
  }
  return result;
}

export function buildInlineStepArgs(args: string[], scope: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  let positionalIndex = 0;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        result[arg.slice(2, eqIndex)] = resolveInlineReference(arg.slice(eqIndex + 1), scope);
      } else {
        result[arg.slice(2)] = true;
      }
    } else {
      result[positionalIndex] = resolveInlineReference(arg, scope);
      positionalIndex++;
    }
  }

  return result;
}

// --- Chainable actions list (shared by pw and pwi) ---

export const CHAINABLE_ACTIONS = [
  'navigate', 'nav', 'refresh', 'reload', 'resize', 'screenshot', 'shot', 'click', 'dblclick', 'hover', 'drag', 'scroll',
  'fill', 'type', 'press', 'select', 'sel', 'upload', 'submit',
  'dump', 'attr', 'wait', 'fetch', 'evaluate', 'eval', 'assert', 'console', 'network', 'dialog',
] as const;

export const CHAINABLE_ACTION_SET = new Set<string>(CHAINABLE_ACTIONS);

// --- :: segment parser (shared by pw and pwi) ---

export interface ChainSegment {
  action: string;
  args: string[];
}

export function isGlobalFlagArg(arg: string, globalFlagNames: Set<string>): boolean {
  return arg.startsWith('--') && globalFlagNames.has(arg.replace(/^--/, '').split('=')[0]);
}

/**
 * Does the post-command argument list ask for help? Intercepted at dispatch so
 * `pw <action> --help` prints usage instead of running the action (a defaulted
 * action like `scroll` would otherwise absorb `--help` as its target and
 * silently execute against the bound session's page).
 */
export function wantsHelp(args: string[]): boolean {
  return args.some(a => a === '--help' || a === '-h');
}

// Peel leading global flags (e.g. `pw --session=x nav url`) off the front so the
// command token is found regardless of flag position — matching the trailing-flag
// and `::` chain paths, which already ignore flag position.
export function splitLeadingGlobalFlags(
  argv: string[],
  globalFlagNames: Set<string>,
): { leadingFlags: string[]; rest: string[] } {
  let i = 0;
  while (i < argv.length && isGlobalFlagArg(argv[i], globalFlagNames)) i++;
  return { leadingFlags: argv.slice(0, i), rest: argv.slice(i) };
}

export function parseChainSegments(
  argv: string[],
  globalFlagNames?: Set<string>,
): { segments: ChainSegment[]; globalFlags: string[] } {
  const isGlobalFlag = globalFlagNames
    ? (a: string) => isGlobalFlagArg(a, globalFlagNames)
    : undefined;

  const segments: ChainSegment[] = [];
  let current: string[] = [];
  const globalFlags: string[] = [];

  for (const a of argv) {
    if (a === '::') {
      if (current.length > 0) segments.push({ action: current[0], args: current.slice(1) });
      current = [];
    } else if (isGlobalFlag?.(a)) {
      globalFlags.push(a);
    } else {
      current.push(a);
    }
  }
  if (current.length > 0) segments.push({ action: current[0], args: current.slice(1) });

  return { segments, globalFlags };
}

// --- Dialog inline handler (shared by sequence.ts and pwi.ts) ---

export async function handleDialogStep(
  pendingDialog: Dialog | null,
  subcommand: string | undefined,
  promptText?: string,
): Promise<{ data: any; cleared: boolean; error?: string }> {
  const sub = subcommand || 'show';

  if (sub === 'show') {
    return {
      data: pendingDialog
        ? { pending: true, type: pendingDialog.type(), message: pendingDialog.message(), defaultValue: pendingDialog.defaultValue() }
        : { pending: false },
      cleared: false,
    };
  }

  if (!pendingDialog) {
    return { data: null, cleared: false, error: 'No pending dialog' };
  }

  if (sub === 'accept') {
    await pendingDialog.accept(promptText).catch(() => {});
    return { data: { action: 'accept', type: pendingDialog.type(), message: pendingDialog.message() }, cleared: true };
  }

  if (sub === 'dismiss') {
    await pendingDialog.dismiss().catch(() => {});
    return { data: { action: 'dismiss', type: pendingDialog.type(), message: pendingDialog.message() }, cleared: true };
  }

  return { data: null, cleared: false, error: `Unknown dialog subcommand: ${sub}. Use accept, dismiss, or show.` };
}
