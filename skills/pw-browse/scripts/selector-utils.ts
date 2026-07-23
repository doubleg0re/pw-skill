// selector-utils.ts — Tells CSS selectors apart from literal UI text for click-like targets.
// click, dblclick, download, and paste all accept a target that may be either. Each used to
// carry its own copy of the rule (and dblclick had none), so they drifted; this is now the
// single place that decides.
import type { Locator, Page } from 'playwright';
import { TARGET_RESOLVE_TIMEOUT_MS } from './constants.js';

export type TargetMode = 'auto' | 'selector' | 'text';

/** "120,340" — a viewport coordinate pair, handled by the mouse rather than a locator. */
export function isCoordinatePair(target: string): boolean {
  return /^\d+,\d+$/.test(target);
}

/** Forward target-resolution flags from a CLI argv into the array form actions parse. */
export function targetFlags(argv: string[]): string[] {
  return argv.filter(arg => arg.startsWith('--mode=') || arg.startsWith('--timeout='));
}

const SIGIL_LED = /^[#.[]/;
const ENGINE_PREFIX = /^(css|xpath|text|id|role|data-testid)=/;
const TAG_QUALIFIED = /^[a-zA-Z][a-zA-Z0-9-]*(\[|#|\.[a-zA-Z_-]|:[a-zA-Z-])/;

/**
 * Heuristic: does this read as a CSS selector rather than visible text?
 * Only the resolution *order* depends on this — resolveClickTarget tries the other
 * interpretation either way — so it favours certainty over catching every selector.
 */
export function looksLikeSelector(target: string): boolean {
  const s = target.trim();
  if (!s) return false;
  if (SIGIL_LED.test(s)) return true;
  if (ENGINE_PREFIX.test(s) || s.startsWith('//') || s.includes('>>')) return true;
  if (TAG_QUALIFIED.test(s)) return true;
  // "Home > Settings" is breadcrumb text and ".nav > li" is a selector; a sigil breaks the tie.
  if (/[>+~]/.test(s) && /[#.[]/.test(s)) return true;
  return false;
}

/**
 * Resolve a click target to a locator, trying the likelier interpretation first and the
 * other one second. `timeout` is the whole resolution budget, so an unmatched target fails
 * in seconds with a diagnosis instead of burning Playwright's 30s auto-wait on one guess.
 * A forced mode skips resolution entirely and leaves the wait to the action itself.
 */
export async function resolveClickTarget(
  page: Page,
  target: string,
  opts: { mode?: TargetMode; timeout?: number } = {},
): Promise<Locator> {
  const budget = opts.timeout ?? TARGET_RESOLVE_TIMEOUT_MS;
  const asSelector = () => page.locator(target).first();
  const asText = () => page.getByText(target, { exact: false }).first();

  if (opts.mode === 'selector') return asSelector();
  if (opts.mode === 'text') return asText();

  const attempts = looksLikeSelector(target)
    ? ([['selector', asSelector], ['text', asText]] as const)
    : ([['text', asText], ['selector', asSelector]] as const);

  // The first interpretation takes the bulk of the budget. Once it times out the page has
  // already had that long to settle, so the second only needs a confirmation pass.
  const firstShare = Math.max(Math.round(budget * 0.7), 1);
  const shares = [firstShare, Math.max(budget - firstShare, 1)];

  const failures: string[] = [];
  for (const [index, [kind, build]] of attempts.entries()) {
    const settled = await settle(build, shares[index]);
    if (settled.locator) return settled.locator;
    failures.push(`${kind}: ${settled.error}`);
  }

  throw new Error(
    `Target matched nothing as ${attempts[0][0]} or ${attempts[1][0]}: "${target}" ` +
    `(waited ${budget}ms total). Force one with --mode=selector|text, or raise --timeout=<ms>.\n` +
    failures.join('\n'),
  );
}

/** Wait for one interpretation to appear. A miss carries its cause so neither is swallowed. */
async function settle(
  build: () => Locator,
  timeout: number,
): Promise<{ locator?: Locator; error?: string }> {
  try {
    const locator = build();
    await locator.waitFor({ state: 'visible', timeout });
    return { locator };
  } catch (cause) {
    // A timeout here, or an invalid-CSS parse error, just means the other interpretation
    // should be tried — but keep the message so a real fault (closed page, bad syntax)
    // still surfaces in the error resolveClickTarget throws when neither lands.
    return { error: (cause as Error).message.split('\n')[0] };
  }
}
