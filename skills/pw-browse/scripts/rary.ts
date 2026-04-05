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

export interface LarryAction {
  entry: string;
  description?: string;
}

/** Declaration of a protocol provided by an extension */
export interface LarryProtocolProvider {
  /**
   * Transport name. Currently only "ws" is supported (via pw-ws-server).
   * Extensions can expand this later (e.g. "ipc", "file").
   */
  transport?: string;
  /**
   * Path (relative to package dir) of the provider implementation.
   * The module must export a default object matching the TransportProvider
   * shape consumed by the transport (e.g. { channel, readSnapshot, subscribe }).
   */
  entry: string;
}

export interface LarryExtensionMeta {
  /** Legacy scope hint */
  scope?: string;
  /**
   * Runtime dependencies on other rary packages.
   * Key is package name, value is install spec (same syntax as `pw rary get`):
   *   "builtin:pw-monitor"
   *   "owner/repo//subdir"
   *   "./relative/path"
   * Version range after `@` is accepted but currently ignored at resolve time.
   */
  dependencies?: Record<string, string>;
  /**
   * Domain protocols this extension provides.
   * Key is a stable protocol identifier like "pw-monitor/v1".
   */
  provides?: {
    protocols?: Record<string, LarryProtocolProvider>;
  };
  /**
   * Domain protocols this extension consumes. Used for documentation
   * and future validation — rary does not currently enforce that a
   * provider is present, only that `dependencies` resolve.
   */
  consumes?: {
    protocols?: string[];
  };
}

export interface LarryManifest {
  name: string;
  version: string;
  description?: string;
  type?: 'script' | 'extension';
  entry?: string;
  commands?: LarryCommand[];
  actions?: Record<string, LarryAction>;
  events?: Record<string, { entry: string }>;
  extension?: LarryExtensionMeta;
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

function hasActionNamespace(actionName: string): boolean {
  return actionName.includes('-');
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEntryPath(
  issues: string[],
  packageDir: string | undefined,
  label: string,
  entry: unknown,
  missingMessage: (entryPath: string) => string,
): void {
  if (!isNonEmptyString(entry)) {
    issues.push(`${label}: expected non-empty string`);
    return;
  }
  if (packageDir && !existsSync(join(packageDir, entry))) {
    issues.push(missingMessage(entry));
  }
}

export function validateLarryManifest(manifest: unknown, opts: { packageDir?: string } = {}): string[] {
  const { packageDir } = opts;
  const issues: string[] = [];

  if (!isPlainObject(manifest)) {
    return ['Manifest must be a JSON object'];
  }

  if (!isNonEmptyString(manifest.name)) {
    issues.push('Missing or invalid "name" in larry.json');
  }
  if (!isNonEmptyString(manifest.version)) {
    issues.push('Missing or invalid "version" in larry.json');
  }
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    issues.push('Invalid "description" in larry.json: expected string');
  }
  if (manifest.type !== undefined && manifest.type !== 'script' && manifest.type !== 'extension') {
    issues.push('Invalid "type" in larry.json: expected "script" or "extension"');
  }
  if (manifest.entry !== undefined) {
    validateEntryPath(
      issues,
      packageDir,
      'Invalid "entry" in larry.json',
      manifest.entry,
      (entryPath) => `Entry file not found: ${entryPath}`,
    );
  }

  if (manifest.commands !== undefined) {
    if (!Array.isArray(manifest.commands)) {
      issues.push('Invalid "commands" in larry.json: expected array');
    } else {
      for (const [index, cmd] of manifest.commands.entries()) {
        if (!isPlainObject(cmd)) {
          issues.push(`Invalid command at index ${index}: expected object`);
          continue;
        }
        if (!isNonEmptyString(cmd.name)) {
          issues.push(`Invalid command name at index ${index}: expected non-empty string`);
        }
        validateEntryPath(
          issues,
          packageDir,
          `Invalid command entry for "${cmd.name || `index ${index}`}"`,
          cmd.entry,
          (entryPath) => `Command entry not found: ${cmd.name || `index ${index}`} -> ${entryPath}`,
        );
      }
    }
  }

  if (manifest.hooks !== undefined) {
    if (!isPlainObject(manifest.hooks)) {
      issues.push('Invalid "hooks" in larry.json: expected object');
    } else {
      for (const [hookName, hook] of Object.entries(manifest.hooks)) {
        if (!isPlainObject(hook)) {
          issues.push(`Invalid hook definition for "${hookName}": expected object`);
          continue;
        }
        validateEntryPath(
          issues,
          packageDir,
          `Invalid hook entry for "${hookName}"`,
          hook.entry,
          (entryPath) => `Hook entry not found: ${hookName} -> ${entryPath}`,
        );
        if (hook.scope !== undefined && !['page', 'session', 'context', 'once'].includes(hook.scope)) {
          issues.push(`Invalid hook scope for "${hookName}": expected one of page, session, context, once`);
        }
      }
    }
  }

  if (manifest.rolling !== undefined) {
    if (!isPlainObject(manifest.rolling)) {
      issues.push('Invalid "rolling" in larry.json: expected object');
    } else {
      validateEntryPath(
        issues,
        packageDir,
        'Invalid rolling entry',
        manifest.rolling.entry,
        (entryPath) => `Rolling entry not found: ${entryPath}`,
      );
    }
  }

  if (manifest.events !== undefined) {
    if (!isPlainObject(manifest.events)) {
      issues.push('Invalid "events" in larry.json: expected object');
    } else {
      for (const [eventName, eventDef] of Object.entries(manifest.events)) {
        if (!isPlainObject(eventDef)) {
          issues.push(`Invalid event handler definition for "${eventName}": expected object`);
          continue;
        }
        validateEntryPath(
          issues,
          packageDir,
          `Invalid event handler entry for "${eventName}"`,
          eventDef.entry,
          (entryPath) => `Event handler entry not found: ${eventName} -> ${entryPath}`,
        );
      }
    }
  }

  if (manifest.actions !== undefined) {
    if (!isPlainObject(manifest.actions)) {
      issues.push('Invalid "actions" in larry.json: expected object');
    } else {
      for (const [actionName, actionDef] of Object.entries(manifest.actions)) {
        if (!hasActionNamespace(actionName)) {
          issues.push(`Action name must include "-" to distinguish extension actions: ${actionName}`);
        }
        if (!isPlainObject(actionDef)) {
          issues.push(`Invalid action definition for "${actionName}": expected object`);
          continue;
        }
        validateEntryPath(
          issues,
          packageDir,
          `Invalid action entry for "${actionName}"`,
          actionDef.entry,
          (entryPath) => `Action entry not found: ${actionName} -> ${entryPath}`,
        );
      }
    }
  }

  if (manifest.extension !== undefined) {
    if (!isPlainObject(manifest.extension)) {
      issues.push('Invalid "extension" in larry.json: expected object');
    } else {
      const ext = manifest.extension as Record<string, any>;
      if (ext.scope !== undefined && typeof ext.scope !== 'string') {
        issues.push('Invalid extension.scope in larry.json: expected string');
      }
      if (ext.dependencies !== undefined) {
        if (!isPlainObject(ext.dependencies)) {
          issues.push('Invalid "extension.dependencies": expected object { name: installSpec }');
        } else {
          for (const [depName, depSpec] of Object.entries(ext.dependencies)) {
            if (!isNonEmptyString(depName)) {
              issues.push('Invalid extension.dependencies key: expected non-empty string');
              continue;
            }
            if (!isNonEmptyString(depSpec)) {
              issues.push(`Invalid extension.dependencies spec for "${depName}": expected non-empty string`);
            }
          }
        }
      }
      if (ext.provides !== undefined) {
        if (!isPlainObject(ext.provides)) {
          issues.push('Invalid "extension.provides": expected object');
        } else if (ext.provides.protocols !== undefined) {
          if (!isPlainObject(ext.provides.protocols)) {
            issues.push('Invalid "extension.provides.protocols": expected object');
          } else {
            for (const [protoName, protoDef] of Object.entries(ext.provides.protocols)) {
              if (!isNonEmptyString(protoName)) {
                issues.push('Invalid extension.provides.protocols key: expected non-empty string');
                continue;
              }
              if (!isPlainObject(protoDef)) {
                issues.push(`Invalid extension.provides.protocols["${protoName}"]: expected object`);
                continue;
              }
              validateEntryPath(
                issues,
                packageDir,
                `Invalid provider entry for protocol "${protoName}"`,
                (protoDef as any).entry,
                (entryPath) => `Protocol provider entry not found: ${protoName} -> ${entryPath}`,
              );
              if ((protoDef as any).transport !== undefined && typeof (protoDef as any).transport !== 'string') {
                issues.push(`Invalid extension.provides.protocols["${protoName}"].transport: expected string`);
              }
            }
          }
        }
      }
      if (ext.consumes !== undefined) {
        if (!isPlainObject(ext.consumes)) {
          issues.push('Invalid "extension.consumes": expected object');
        } else if (ext.consumes.protocols !== undefined) {
          if (!Array.isArray(ext.consumes.protocols)) {
            issues.push('Invalid "extension.consumes.protocols": expected array of strings');
          } else {
            for (const [idx, proto] of ext.consumes.protocols.entries()) {
              if (!isNonEmptyString(proto)) {
                issues.push(`Invalid extension.consumes.protocols[${idx}]: expected non-empty string`);
              }
            }
          }
        }
      }
    }
  }

  return issues;
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
        if (manifest.commands && Array.isArray(manifest.commands)) {
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
        // Check event handler entries
        if (manifest.events) {
          for (const [eventName, eventDef] of Object.entries(manifest.events)) {
            if (eventDef?.entry && !existsSync(join(pkgDir(name), eventDef.entry)))
              issues.push({ package: name, issue: `Event handler entry not found: ${eventName} → ${eventDef.entry}` });
          }
        }
        // Check action entries
        if (manifest.actions) {
          for (const [actionName, actionDef] of Object.entries(manifest.actions)) {
            if (!hasActionNamespace(actionName)) {
              issues.push({ package: name, issue: `Action name must include "-" to distinguish extension actions: ${actionName}` });
            }
            if (actionDef?.entry && !existsSync(join(pkgDir(name), actionDef.entry)))
              issues.push({ package: name, issue: `Action entry not found: ${actionName} → ${actionDef.entry}` });
          }
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
          // Create per-extension runtime view with prefixed logger
          let extContext = context;
          if (context && typeof context === 'object' && context.logger) {
            const { createExtensionView } = await import('./runtime.js');
            extContext = createExtensionView(context, name);
          }
          if (typeof hookModule.default === 'function') {
            await hookModule.default(extContext);
          } else if (typeof hookModule[hookName] === 'function') {
            await hookModule[hookName](extContext);
          }
          ran.push(name);
        } catch (err) {
          errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { ran, errors };
    },

    // --- Extension Actions ---

    /**
     * Load custom sequence actions from active extensions.
     * Returns a map of action name → async function(page, args).
     */
    async loadExtensionActions(): Promise<{
      actions: Record<string, (page: any, args: any) => Promise<{ result?: any }>>;
      warnings: string[];
      errors: string[];
    }> {
      const actions: Record<string, (page: any, args: any) => Promise<{ result?: any }>> = {};
      const warnings: string[] = [];
      const errors: string[] = [];

      for (const { name, manifest } of this.getActiveExtensions()) {
        if (!manifest?.actions) continue;

        for (const [actionName, actionDef] of Object.entries(manifest.actions)) {
          if (!hasActionNamespace(actionName)) {
            errors.push(`${name}: action "${actionName}" must include "-" to distinguish extension actions from built-ins`);
            continue;
          }
          // Collision check
          if (actions[actionName]) {
            errors.push(`Extension action "${actionName}" is defined by multiple active packages`);
            continue;
          }

          const actionPath = join(pkgDir(name), actionDef.entry);
          if (!existsSync(actionPath)) {
            errors.push(`${name}: action entry not found: ${actionPath}`);
            continue;
          }

          try {
            const actionUrl = pathToFileURL(actionPath).href;
            const mod = await import(actionUrl);
            const fn = mod.default || mod.run;
            if (typeof fn !== 'function') {
              errors.push(`${name}: action "${actionName}" must export default function or named "run"`);
              continue;
            }
            actions[actionName] = fn;
          } catch (err) {
            errors.push(`${name}: failed to load action "${actionName}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      if (Object.keys(actions).length > 0) {
        warnings.push(`Active rary extensions registered custom sequence actions: ${Object.keys(actions).join(', ')}. Run only trusted extensions.`);
      }

      return { actions, warnings, errors };
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
export const loadExtensionActions = defaultStore.loadExtensionActions.bind(defaultStore);

export const TOYBOX_DIR = defaultStore.toyboxDir;
export const EXTENSIONS_FILE = defaultStore.extensionsFile;
