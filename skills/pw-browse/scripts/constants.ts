// constants.ts — Shared limits and magic numbers
// Only values reused across multiple files belong here.
// One-off values should stay in their respective files.

/** Polling interval for assert retry loops (ms) */
export const ASSERT_POLL_INTERVAL_MS = 100;

/** Maximum body length for network dump truncation (chars) */
export const NETWORK_BODY_LIMIT = 5000;

/** Console log entry truncation length (chars) */
export const CONSOLE_LOG_ENTRY_LIMIT = 2000;

/** Dump strict mode content limit (chars) */
export const DUMP_STRICT_CONTENT_LIMIT = 50_000;
