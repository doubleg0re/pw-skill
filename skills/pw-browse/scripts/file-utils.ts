// file-utils.ts — Safe filesystem utilities
import { writeFileSync, unlinkSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

/**
 * Write JSON atomically — safe on Windows and Unix.
 * 1. Write to temp file in same directory
 * 2. Remove destination if it exists (Windows rename fails otherwise)
 * 3. Rename temp to destination
 */
export function atomicWriteJSON(filePath: string, data: any): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomBytes(6).toString('hex')}.json`);

  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    try { unlinkSync(filePath); } catch {}
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Read JSON safely — returns null on missing or malformed.
 */
export function readJSONSafe<T = any>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const { readFileSync } = require('fs');
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
