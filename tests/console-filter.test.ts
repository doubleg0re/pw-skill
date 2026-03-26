import { describe, it, expect } from 'vitest';
import { filterLines } from '../skills/pw-browse/scripts/console.js';

const SAMPLE_LOGS = [
  '[2026-03-27T00:00:00.000Z] [LOG] page loaded',
  '[2026-03-27T00:00:01.000Z] [ERROR] Failed to fetch /api/users',
  '[2026-03-27T00:00:02.000Z] [WARN] Deprecated API usage',
  '[2026-03-27T00:00:03.000Z] [DEBUG] heartbeat ping',
  '[2026-03-27T00:00:04.000Z] [ERROR] CORS policy blocked /api/data',
  '[2026-03-27T00:00:05.000Z] [INFO] User logged in',
  '[2026-03-27T00:00:06.000Z] [LOG] Response 200 OK',
  '[2026-03-27T00:00:07.000Z] [ERROR] timeout after 30000ms',
];

describe('Console filter — include (+)', () => {
  it('filters by single keyword', () => {
    const result = filterLines(SAMPLE_LOGS, ['+ERROR']);
    expect(result).toHaveLength(3);
    expect(result.every(l => l.includes('[ERROR]'))).toBe(true);
  });

  it('filters by multiple keywords (OR)', () => {
    const result = filterLines(SAMPLE_LOGS, ['+ERROR', '+WARN']);
    expect(result).toHaveLength(4);
  });

  it('is case-insensitive', () => {
    const result = filterLines(SAMPLE_LOGS, ['+error']);
    expect(result).toHaveLength(3);
  });
});

describe('Console filter — exclude (-)', () => {
  it('excludes by keyword', () => {
    const result = filterLines(SAMPLE_LOGS, ['-heartbeat']);
    expect(result).toHaveLength(7);
    expect(result.every(l => !l.includes('heartbeat'))).toBe(true);
  });

  it('excludes multiple keywords', () => {
    const result = filterLines(SAMPLE_LOGS, ['-DEBUG', '-INFO']);
    expect(result).toHaveLength(6);
  });

  it('does not treat --flags as excludes', () => {
    const result = filterLines(SAMPLE_LOGS, ['--raw']);
    expect(result).toHaveLength(8); // no filtering
  });
});

describe('Console filter — combined', () => {
  it('include + exclude together', () => {
    // ERROR lines but not CORS
    const result = filterLines(SAMPLE_LOGS, ['+ERROR', '-CORS']);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('Failed to fetch');
    expect(result[1]).toContain('timeout');
  });

  it('no filters returns all lines', () => {
    const result = filterLines(SAMPLE_LOGS, []);
    expect(result).toHaveLength(8);
  });
});

describe('Console filter — regex', () => {
  it('matches with regex pattern', () => {
    const result = filterLines(SAMPLE_LOGS, ['+/timeout.*\\d+ms/']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('timeout after 30000ms');
  });

  it('excludes with regex pattern', () => {
    const result = filterLines(SAMPLE_LOGS, ['-/api\\//']);
    expect(result).toHaveLength(6);
  });

  it('combines regex and plain keywords', () => {
    // ERROR lines (3 total), exclude any containing "cors" (case-insensitive by default)
    const result = filterLines(SAMPLE_LOGS, ['+ERROR', '-/CORS/']);
    expect(result).toHaveLength(2);
    expect(result.every(l => !l.includes('CORS'))).toBe(true);
  });
});
