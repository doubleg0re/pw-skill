// rary.ts — Larry's package and extension ecosystem
// Toybox lives at {toyboxDir}/{package-name}/
// Extensions register in {extensionsFile}
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { homedir } from 'os';

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

// --- Types ---

export interface ExtensionEntry {
  package: string;
  activatedAt: string;
}

export interface RepairIssue {
  package: string;
  issue: string;
}

export interface RaryStoreOptions {
  toyboxDir: string;
  extensionsFile: string;
}

// --- Store factory ---

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function createRaryStore(opts: RaryStoreOptions) {
  const { toyboxDir, extensionsFile } = opts;

  function pkgDir(name: string): string {
    return join(toyboxDir, name);
  }

  function loadExtensions(): Record<string, ExtensionEntry> {
    if (!existsSync(extensionsFile)) return {};
    try { return JSON.parse(readFileSync(extensionsFile, 'utf-8')); } catch { return {}; }
  }

  function saveExtensions(ext: Record<string, ExtensionEntry>): void {
    ensureDir(join(extensionsFile, '..'));
    writeFileSync(extensionsFile, JSON.stringify(ext, null, 2));
  }

  return {
    // --- Package CRUD ---

    packageDir: pkgDir,

    getManifest(name: string): LarryManifest | null {
      const file = join(pkgDir(name), 'larry.json');
      if (!existsSync(file)) return null;
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return null; }
    },

    isInstalled(name: string): boolean {
      return existsSync(pkgDir(name)) && this.getManifest(name) !== null;
    },

    listPackages(): { name: string; manifest: LarryManifest | null }[] {
      ensureDir(toyboxDir);
      return readdirSync(toyboxDir).map(name => ({
        name,
        manifest: this.getManifest(name),
      }));
    },

    removePackage(name: string): void {
      const dir = pkgDir(name);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      this.deactivateExtension(name);
    },

    // --- Extension activation ---

    isExtensionActive(name: string): boolean {
      return !!loadExtensions()[name];
    },

    activateExtension(name: string): void {
      const ext = loadExtensions();
      ext[name] = { package: name, activatedAt: new Date().toISOString() };
      saveExtensions(ext);
    },

    deactivateExtension(name: string): void {
      const ext = loadExtensions();
      if (ext[name]) {
        delete ext[name];
        saveExtensions(ext);
      }
    },

    getActiveExtensions(): { name: string; manifest: LarryManifest | null; entry: ExtensionEntry }[] {
      const ext = loadExtensions();
      return Object.entries(ext).map(([name, entry]) => ({
        name,
        manifest: this.getManifest(name),
        entry,
      }));
    },

    // --- Repair ---

    checkRepair(): RepairIssue[] {
      const issues: RepairIssue[] = [];

      for (const { name, manifest } of this.listPackages()) {
        if (!manifest) {
          issues.push({ package: name, issue: 'Missing larry.json' });
          continue;
        }
        if (!manifest.name) issues.push({ package: name, issue: 'Missing name in larry.json' });
        if (!manifest.version) issues.push({ package: name, issue: 'Missing version in larry.json' });

        if (manifest.entry) {
          if (!existsSync(join(pkgDir(name), manifest.entry)))
            issues.push({ package: name, issue: `Entry file not found: ${manifest.entry}` });
        }
        if (manifest.commands) {
          for (const cmd of manifest.commands) {
            if (!existsSync(join(pkgDir(name), cmd.entry)))
              issues.push({ package: name, issue: `Command entry not found: ${cmd.name} → ${cmd.entry}` });
          }
        }
        if (manifest.hooks) {
          for (const [hookName, hook] of Object.entries(manifest.hooks)) {
            if (hook?.entry && !existsSync(join(pkgDir(name), hook.entry)))
              issues.push({ package: name, issue: `Hook entry not found: ${hookName} → ${hook.entry}` });
          }
        }
        if (manifest.rolling?.entry) {
          if (!existsSync(join(pkgDir(name), manifest.rolling.entry)))
            issues.push({ package: name, issue: `Rolling entry not found: ${manifest.rolling.entry}` });
        }
      }

      // Ghost extensions
      const ext = loadExtensions();
      for (const name of Object.keys(ext)) {
        if (!this.isInstalled(name))
          issues.push({ package: name, issue: 'Active extension but package not installed' });
      }

      return issues;
    },

    // --- Hook execution ---

    async runHooks(hookName: 'launch' | 'load' | 'close', context?: any): Promise<{ ran: string[]; errors: string[] }> {
      const ran: string[] = [];
      const errors: string[] = [];

      for (const { name, manifest } of this.getActiveExtensions()) {
        if (!manifest?.hooks?.[hookName]) continue;

        const hook = manifest.hooks[hookName]!;
        const hookPath = join(pkgDir(name), hook.entry);

        if (!existsSync(hookPath)) {
          errors.push(`${name}: hook file not found: ${hookPath}`);
          continue;
        }

        try {
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
    },

    // --- Paths ---

    get toyboxDir() { return toyboxDir; },
    get extensionsFile() { return extensionsFile; },
  };
}

export type RaryStore = ReturnType<typeof createRaryStore>;

// --- Default instance (production) ---

const GLOBAL_STATE = join(homedir(), '.playwright-state');

const defaultStore = createRaryStore({
  toyboxDir: join(GLOBAL_STATE, 'toybox'),
  extensionsFile: join(GLOBAL_STATE, 'extensions.json'),
});

// Re-export for backward compatibility
export const packageDir = defaultStore.packageDir.bind(defaultStore);
export const getManifest = defaultStore.getManifest.bind(defaultStore);
export const isInstalled = defaultStore.isInstalled.bind(defaultStore);
export const listPackages = defaultStore.listPackages.bind(defaultStore);
export const removePackage = defaultStore.removePackage.bind(defaultStore);
export const isExtensionActive = defaultStore.isExtensionActive.bind(defaultStore);
export const activateExtension = defaultStore.activateExtension.bind(defaultStore);
export const deactivateExtension = defaultStore.deactivateExtension.bind(defaultStore);
export const getActiveExtensions = defaultStore.getActiveExtensions.bind(defaultStore);
export const checkRepair = defaultStore.checkRepair.bind(defaultStore);
export const runHooks = defaultStore.runHooks.bind(defaultStore);

export const TOYBOX_DIR = defaultStore.toyboxDir;
export const EXTENSIONS_FILE = defaultStore.extensionsFile;
