// browser-registry.ts — user-registered browser binaries, replacing the old
// hardcoded macOS enum. `--browser=<name>` resolves against this. Two scopes:
// local (`<cwd>/.playwright-state/browsers.json`, project-specific) overrides
// global (`~/.playwright-state/browsers.json`, shared).
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { atomicWriteJSON } from './file-utils.js';
import { localStateDir } from './session.js';

export interface RegisteredBrowser {
  path: string;
  label?: string;
  /** Default session name for `pw launch --browser=<name>` when --name is omitted. */
  defaultName?: string;
}
export type BrowserRegistry = Record<string, RegisteredBrowser>;

export function globalRegistryPath(): string {
  return join(homedir(), '.playwright-state', 'browsers.json');
}
export function localRegistryPath(cwd?: string): string {
  return join(localStateDir(cwd), 'browsers.json');
}

function readFileRegistry(p: string): BrowserRegistry {
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Pure merge: local entries win over global ones with the same name. */
export function mergeRegistries(global: BrowserRegistry, local: BrowserRegistry): BrowserRegistry {
  return { ...global, ...local };
}

/** Merged view (local over global) — used to resolve `--browser=<name>`. */
export function readBrowserRegistry(cwd?: string): BrowserRegistry {
  return mergeRegistries(readFileRegistry(globalRegistryPath()), readFileRegistry(localRegistryPath(cwd)));
}

/** Per-scope view for `pw browser list` (keeps which file each entry lives in). */
export function readBrowserRegistryScoped(cwd?: string): Array<{ name: string; scope: 'local' | 'global'; entry: RegisteredBrowser }> {
  const global = readFileRegistry(globalRegistryPath());
  const local = readFileRegistry(localRegistryPath(cwd));
  const out: Array<{ name: string; scope: 'local' | 'global'; entry: RegisteredBrowser }> = [];
  for (const [name, entry] of Object.entries(global)) {
    if (!(name in local)) out.push({ name, scope: 'global', entry });
  }
  for (const [name, entry] of Object.entries(local)) {
    out.push({ name, scope: 'local', entry });
  }
  return out;
}

export function registerBrowser(
  name: string,
  path: string,
  opts: { label?: string; defaultName?: string; global?: boolean; cwd?: string } = {},
): RegisteredBrowser {
  if (!existsSync(path)) throw new Error(`Binary not found: ${path}`);
  const file = opts.global ? globalRegistryPath() : localRegistryPath(opts.cwd);
  const reg = readFileRegistry(file);
  const entry: RegisteredBrowser = {
    path,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.defaultName ? { defaultName: opts.defaultName } : {}),
  };
  reg[name] = entry;
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteJSON(file, reg);
  return entry;
}

export function unregisterBrowser(name: string, opts: { global?: boolean; cwd?: string } = {}): boolean {
  const file = opts.global ? globalRegistryPath() : localRegistryPath(opts.cwd);
  const reg = readFileRegistry(file);
  if (!(name in reg)) return false;
  delete reg[name];
  atomicWriteJSON(file, reg);
  return true;
}
