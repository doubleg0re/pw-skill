// fetch-utils.ts — Shared helpers for pw fetch auth/credentials behavior

export type FetchCredentialsMode = 'omit' | 'same-origin' | 'include';

export function resolveFetchCredentials(raw?: string): FetchCredentialsMode {
  if (!raw) return 'include';
  if (raw === 'omit' || raw === 'same-origin' || raw === 'include') return raw;
  throw new Error(`Invalid credentials mode "${raw}". Use include, same-origin, or omit.`);
}

export function normalizeAuthHeader(raw?: string): string | undefined {
  if (raw === undefined) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  if (/^(Bearer|Basic|Token)\s+/i.test(value)) return value;
  return `Bearer ${value}`;
}
