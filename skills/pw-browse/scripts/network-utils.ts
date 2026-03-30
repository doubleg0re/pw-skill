// ~/.claude/skills/pw-browse/scripts/network-utils.ts
// Pure ndjson helpers for structured network log read/write
import { existsSync, readFileSync, appendFileSync } from 'fs';

export interface StructuredNetworkEntry {
  timestamp: string;
  type: string;
  method: string;
  url: string;
  status: number;
  requestBody?: string;
  responseBody?: string;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
  redactionLevel?: string;
  bodyLimit?: number;
}

const DEFAULT_BODY_LIMIT = 5000;

export function writeNdjsonEntry(filePath: string, entry: StructuredNetworkEntry): void {
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

export function readNdjsonEntries(filePath: string, urlPattern: string, bodyLimit?: number): StructuredNetworkEntry[] {
  if (!existsSync(filePath)) return [];

  const limit = bodyLimit ?? DEFAULT_BODY_LIMIT;
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  const results: StructuredNetworkEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: StructuredNetworkEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry.url.includes(urlPattern)) continue;

    if (entry.requestBody && entry.requestBody.length > limit) {
      entry.requestBody = entry.requestBody.substring(0, limit);
      entry.requestBodyTruncated = true;
      entry.bodyLimit = limit;
    }
    if (entry.responseBody && entry.responseBody.length > limit) {
      entry.responseBody = entry.responseBody.substring(0, limit);
      entry.responseBodyTruncated = true;
      entry.bodyLimit = limit;
    }

    results.push(entry);
  }
  return results;
}
