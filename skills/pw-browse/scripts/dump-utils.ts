// dump-utils.ts — Pure utility functions for dump content processing

export interface HeadTruncateResult {
  content: string;
  truncated: boolean;
  head?: number;
  originalLength?: number;
}

/**
 * Truncate content to `head` characters.
 * When head is undefined or >= content length, returns original content unchanged.
 */
export function headTruncate(content: string, head?: number): HeadTruncateResult {
  if (head === undefined || head >= content.length) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, head),
    truncated: true,
    head,
    originalLength: content.length,
  };
}
