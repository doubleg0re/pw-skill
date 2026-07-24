// pin-utils.ts — Opt-in guard against a shared session drifting to another app.
//
// Parallel agents sharing one session have written to the wrong app: the page moved
// to a different project's origin and subsequent writes landed there, blanking real
// data. Pinning is opt-in (`pw launch/use --pin`) so nothing existing changes, and
// only origin is compared — in-app navigation stays free.

/** Origin of a navigable http(s) url, or null for about:blank / garbage. */
export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Message describing a pin violation, or null when the command may proceed.
 * A blank or unparseable page is not treated as drift — a session often sits on
 * about:blank before its first navigation.
 */
export function pinViolation(pinnedOrigin: string | undefined, currentUrl: string): string | null {
  if (!pinnedOrigin) return null;
  const current = originOf(currentUrl);
  if (current === null || current === pinnedOrigin) return null;
  return `session is pinned to ${pinnedOrigin} but the page is at ${current}. ` +
    `Navigate back, re-pin with \`pw use <name> --pin\`, or pass --no-pin-check for this command.`;
}
