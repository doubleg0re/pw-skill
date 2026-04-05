#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export function runTsxEntry(relativeEntry) {
  const binDir = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(binDir, '..', relativeEntry);

  const candidates = [
    resolve(binDir, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    resolve(binDir, '..', '..', 'tsx', 'dist', 'cli.mjs'),
  ];
  const tsxCli = candidates.find(existsSync);

  if (!tsxCli) {
    console.error('pw-skill: tsx runtime not found. Reinstall the package.');
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    [tsxCli, entry, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}
