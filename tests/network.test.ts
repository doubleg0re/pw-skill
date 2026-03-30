import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeNdjsonEntry, readNdjsonEntries, type StructuredNetworkEntry } from '../skills/pw-browse/scripts/network-utils.js';

function tmpFile(): string {
  return join(tmpdir(), `network-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

describe('writeNdjsonEntry', () => {
  it('appends JSON lines correctly', () => {
    const file = tmpFile();
    try {
      const entry1: StructuredNetworkEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'fetch',
        method: 'GET',
        url: 'https://api.example.com/users',
        status: 200,
      };
      const entry2: StructuredNetworkEntry = {
        timestamp: '2026-01-01T00:00:01.000Z',
        type: 'xhr',
        method: 'POST',
        url: 'https://api.example.com/login',
        status: 201,
        requestBody: '{"user":"alice"}',
      };

      writeNdjsonEntry(file, entry1);
      writeNdjsonEntry(file, entry2);

      const lines = readFileSync(file, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject(entry1);
      expect(JSON.parse(lines[1])).toMatchObject(entry2);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });
});

describe('readNdjsonEntries', () => {
  it('reads and filters by URL pattern', () => {
    const file = tmpFile();
    try {
      writeNdjsonEntry(file, { timestamp: 't1', type: 'fetch', method: 'GET', url: 'https://api.example.com/users', status: 200 });
      writeNdjsonEntry(file, { timestamp: 't2', type: 'fetch', method: 'POST', url: 'https://api.example.com/login', status: 200 });
      writeNdjsonEntry(file, { timestamp: 't3', type: 'xhr', method: 'GET', url: 'https://other.com/data', status: 200 });

      const results = readNdjsonEntries(file, 'api.example.com');
      expect(results).toHaveLength(2);
      expect(results.every(e => e.url.includes('api.example.com'))).toBe(true);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });

  it('returns empty for non-matching pattern', () => {
    const file = tmpFile();
    try {
      writeNdjsonEntry(file, { timestamp: 't1', type: 'fetch', method: 'GET', url: 'https://api.example.com/users', status: 200 });

      const results = readNdjsonEntries(file, 'nonexistent.com');
      expect(results).toHaveLength(0);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });

  it('returns empty for missing file', () => {
    const results = readNdjsonEntries('/tmp/does-not-exist-ever.ndjson', 'anything');
    expect(results).toHaveLength(0);
  });
});

describe('body truncation', () => {
  it('truncates to default 5000 limit', () => {
    const file = tmpFile();
    try {
      const longBody = 'x'.repeat(6000);
      writeNdjsonEntry(file, {
        timestamp: 't1', type: 'fetch', method: 'GET',
        url: 'https://api.example.com/data', status: 200,
        responseBody: longBody,
      });

      const results = readNdjsonEntries(file, 'api.example.com');
      expect(results).toHaveLength(1);
      expect(results[0].responseBody).toHaveLength(5000);
      expect(results[0].responseBodyTruncated).toBe(true);
      expect(results[0].bodyLimit).toBe(5000);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });

  it('does not truncate within limit', () => {
    const file = tmpFile();
    try {
      const shortBody = 'hello world';
      writeNdjsonEntry(file, {
        timestamp: 't1', type: 'fetch', method: 'GET',
        url: 'https://api.example.com/data', status: 200,
        responseBody: shortBody,
      });

      const results = readNdjsonEntries(file, 'api.example.com');
      expect(results).toHaveLength(1);
      expect(results[0].responseBody).toBe(shortBody);
      expect(results[0].responseBodyTruncated).toBeUndefined();
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });

  it('custom bodyLimit works', () => {
    const file = tmpFile();
    try {
      const body = 'a'.repeat(200);
      writeNdjsonEntry(file, {
        timestamp: 't1', type: 'fetch', method: 'POST',
        url: 'https://api.example.com/submit', status: 201,
        requestBody: body,
      });

      const results = readNdjsonEntries(file, 'api.example.com', 100);
      expect(results).toHaveLength(1);
      expect(results[0].requestBody).toHaveLength(100);
      expect(results[0].requestBodyTruncated).toBe(true);
      expect(results[0].bodyLimit).toBe(100);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  });
});
