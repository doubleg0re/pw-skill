// rary.ts — Larry's package and extension ecosystem
// Toybox lives at ~/.playwright-state/toybox/{package-name}/
// Extensions register in ~/.playwright-state/extensions.json
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { homedir } from 'os';

// --- Paths ---

const GLOBAL_STATE = join(homedir(), '.playwright-state');
const TOYBOX_DIR = join(GLOBAL_STATE, 'toybox');
const EXTENSIONS_FILE = join(GLOBAL_STATE, 'extensions.json');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- larry.json schema ---

export interface LarryCommand {
  name: string;
  entry: string;
}

export interface LarryHook {
  entry: string;
  scope?: 'page' | 'session' | 'context' | 'once';
}

export interface LarryManifest {
  name: string;
  version: string;
  description?: string;
  type?: 'script' | 'extension';
  entry?: string;
  commands?: LarryCommand[];
  extension?: {
    scope?: string;
  };
  hooks?: {
    load?: LarryHook;
    launch?: LarryHook;
    close?: LarryHook;
  };
  rolling?: {
    entry: string;
  };
}

// --- Extensions registry ---

export interface ExtensionEntry {
  package: string;
  activatedAt: string;
}

function loadExtensions(): Record<string, ExtensionEntry> {
  if (!existsSync(EXTENSIONS_FILE)) return {};
  try { return JSON.parse(readFileSync(EXTENSIONS_FILE, 'utf-8')); } catch { return {}; }
}

function saveExtensions(ext: Record<string, ExtensionEntry>): void {
  ensureDir(GLOBAL_STATE);
  writeFileSync(EXTENSIONS_FILE, JSON.stringify(ext, null, 2));
}

// --- Package operations ---

export function packageDir(name: string): string {
  return join(TOYBOX_DIR, name);
}

export function getManifest(name: string): LarryManifest | null {
  const file = join(packageDir(name), 'larry.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return null; }
}

export function isInstalled(name: string): boolean {
  return existsSync(packageDir(name)) && getManifest(name) !== null;
}

export function listPackages(): { name: string; manifest: LarryManifest | null }[] {
  ensureDir(TOYBOX_DIR);
  return readdirSync(TOYBOX_DIR).map(name => ({
    name,
    manifest: getManifest(name),
  }));
}

export function removePackage(name: string): void {
  const dir = packageDir(name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  // Also deactivate if active
  const ext = loadExtensions();
  if (ext[name]) {
    delete ext[name];
    saveExtensions(ext);
  }
}

export function isExtensionActive(name: string): boolean {
  const ext = loadExtensions();
  return !!ext[name];
}

export function activateExtension(name: string): void {
  const ext = loadExtensions();
  ext[name] = { package: name, activatedAt: new Date().toISOString() };
  saveExtensions(ext);
}

export function deactivateExtension(name: string): void {
  const ext = loadExtensions();
  if (ext[name]) {
    delete ext[name];
    saveExtensions(ext);
  }
}

export function getActiveExtensions(): { name: string; manifest: LarryManifest | null; entry: ExtensionEntry }[] {
  const ext = loadExtensions();
  return Object.entries(ext).map(([name, entry]) => ({
    name,
    manifest: getManifest(name),
    entry,
  }));
}

// --- Repair check ---

export interface RepairIssue {
  package: string;
  issue: string;
}

export function checkRepair(): RepairIssue[] {
  const issues: RepairIssue[] = [];

  for (const { name, manifest } of listPackages()) {
    if (!manifest) {
      issues.push({ package: name, issue: 'Missing larry.json' });
      continue;
    }

    if (!manifest.name) issues.push({ package: name, issue: 'Missing name in larry.json' });
    if (!manifest.version) issues.push({ package: name, issue: 'Missing version in larry.json' });

    // Check entry file
    if (manifest.entry) {
      const entryPath = join(packageDir(name), manifest.entry);
      if (!existsSync(entryPath)) issues.push({ package: name, issue: `Entry file not found: ${manifest.entry}` });
    }

    // Check command entries
    if (manifest.commands) {
      for (const cmd of manifest.commands) {
        const cmdPath = join(packageDir(name), cmd.entry);
        if (!existsSync(cmdPath)) issues.push({ package: name, issue: `Command entry not found: ${cmd.name} → ${cmd.entry}` });
      }
    }

    // Check hook entries
    if (manifest.hooks) {
      for (const [hookName, hook] of Object.entries(manifest.hooks)) {
        if (hook?.entry) {
          const hookPath = join(packageDir(name), hook.entry);
          if (!existsSync(hookPath)) issues.push({ package: name, issue: `Hook entry not found: ${hookName} → ${hook.entry}` });
        }
      }
    }

    // Check rolling entry
    if (manifest.rolling?.entry) {
      const rollingPath = join(packageDir(name), manifest.rolling.entry);
      if (!existsSync(rollingPath)) issues.push({ package: name, issue: `Rolling entry not found: ${manifest.rolling.entry}` });
    }
  }

  // Check active extensions point to valid packages
  const ext = loadExtensions();
  for (const name of Object.keys(ext)) {
    if (!isInstalled(name)) {
      issues.push({ package: name, issue: 'Active extension but package not installed' });
    }
  }

  return issues;
}

// --- Hook execution ---

export async function runHooks(hookName: 'launch' | 'load' | 'close', context?: any): Promise<{ ran: string[]; errors: string[] }> {
  const ran: string[] = [];
  const errors: string[] = [];

  for (const { name, manifest } of getActiveExtensions()) {
    if (!manifest?.hooks?.[hookName]) continue;

    const hook = manifest.hooks[hookName]!;
    const hookPath = join(packageDir(name), hook.entry);

    if (!existsSync(hookPath)) {
      errors.push(`${name}: hook file not found: ${hookPath}`);
      continue;
    }

    try {
      // Use file:// URL for cross-platform ESM import compatibility (especially Windows)
      const hookUrl = pathToFileURL(hookPath).href;
      const hookModule = await import(hookUrl);
      if (typeof hookModule.default === 'function') {
        await hookModule.default(context);
      } else if (typeof hookModule[hookName] === 'function') {
        await hookModule[hookName](context);
      }
      ran.push(name);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ran, errors };
}

// --- Toybox path export ---

export { TOYBOX_DIR, EXTENSIONS_FILE };
