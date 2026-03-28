// rary-commands.ts — CLI handlers for pw rary subcommands
// Accepts a RaryStore for testability. Production uses default store.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve, basename } from 'path';
import {
  createRaryStore,
  type RaryStore,
} from './rary.js';
import { homedir } from 'os';

interface Result {
  success: boolean;
  data?: any;
  error?: string;
  warnings?: string[];
}

// --- Factory: create commands bound to a store ---

export function createRaryCommands(store: RaryStore) {

  // --- get <repo> ---
  async function get(args: string[]): Promise<Result> {
    const repo = args[0];
    if (!repo) return { success: false, error: 'Usage: pw rary get <repo|path>' };

    if (!existsSync(store.toyboxDir)) mkdirSync(store.toyboxDir, { recursive: true });

    const repoName = basename(repo).replace(/\.git$/, '') || repo;

    if (store.isInstalled(repoName)) {
      return { success: false, error: `Package "${repoName}" already installed. Use \`pw rary destroy ${repoName}\` first.` };
    }

    const targetDir = store.packageDir(repoName);

    // Local path
    if (existsSync(repo)) {
      const absPath = resolve(repo);
      const copyResult = process.platform === 'win32'
        ? spawnSync('xcopy', [absPath, targetDir, '/E', '/I', '/Q'], { stdio: 'ignore' })
        : spawnSync('cp', ['-r', absPath, targetDir], { stdio: 'ignore' });

      if (copyResult.status !== 0) {
        return { success: false, error: `Failed to copy "${absPath}" to toybox (exit code ${copyResult.status})` };
      }
      if (!existsSync(targetDir)) {
        return { success: false, error: `Copy appeared to succeed but target directory not found: ${targetDir}` };
      }
    } else {
      // Git clone (array args, no shell)
      const gitUrl = repo.includes('://') ? repo : `https://github.com/${repo}.git`;
      const cloneResult = spawnSync('git', ['clone', '--depth', '1', gitUrl, targetDir], { stdio: 'ignore' });
      if (cloneResult.status !== 0) {
        return { success: false, error: `Failed to clone "${repo}" (exit code ${cloneResult.status})` };
      }
    }

    const manifest = store.getManifest(repoName);

    // Install npm dependencies if package.json exists
    const pkgJson = join(targetDir, 'package.json');
    if (existsSync(pkgJson)) {
      spawnSync('npm', ['install', '--production'], { cwd: targetDir, stdio: 'ignore' });
    }

    return {
      success: true,
      data: {
        message: `Fetched toy "${repoName}" into the toybox.`,
        package: repoName,
        manifest: manifest ? { name: manifest.name, version: manifest.version, type: manifest.type, description: manifest.description } : null,
        hint: manifest?.rolling ? `Run \`pw rary rolling ${repoName}\` for first-time setup.` : undefined,
      },
    };
  }

  // --- toybox ---
  function toybox(): Result {
    const packages = store.listPackages();

    const list = packages.map(({ name, manifest }) => ({
      name,
      version: manifest?.version || 'unknown',
      type: manifest?.type || 'script',
      description: manifest?.description || '',
      active: store.isExtensionActive(name),
      commands: manifest?.commands?.map(c => c.name) || [],
    }));

    return {
      success: true,
      data: {
        message: list.length > 0 ? `Larry's toybox (${list.length} toys):` : `Larry's toybox is empty. Try \`pw rary get <repo>\`.`,
        packages: list,
      },
    };
  }

  // --- peek <package> ---
  function peek(args: string[]): Result {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary peek <package>' };

    if (!store.isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

    const manifest = store.getManifest(name)!;
    const active = store.isExtensionActive(name);

    return {
      success: true,
      data: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        type: manifest.type || 'script',
        entry: manifest.entry,
        active,
        commands: manifest.commands || [],
        hooks: manifest.hooks ? Object.keys(manifest.hooks) : [],
        rolling: manifest.rolling ? { entry: manifest.rolling.entry } : null,
        extension: manifest.extension || null,
      },
    };
  }

  // --- destroy / kick ---
  function destroy(args: string[]): Result {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary destroy <package>' };

    if (!existsSync(store.packageDir(name))) {
      return { success: false, error: `Package "${name}" not found in toybox.` };
    }

    const wasActive = store.isExtensionActive(name);
    store.removePackage(name);

    return {
      success: true,
      data: {
        message: `Toy "${name}" has been removed from the toybox.`,
        package: name,
        wasActive,
      },
    };
  }

  // --- rolling ---
  async function rolling(args: string[]): Promise<Result> {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary rolling <package>' };

    if (!store.isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

    const manifest = store.getManifest(name)!;
    if (!manifest.rolling?.entry) {
      return { success: false, error: `Package "${name}" has no rolling (setup) entry defined.` };
    }

    const setupPath = join(store.packageDir(name), manifest.rolling.entry);
    if (!existsSync(setupPath)) {
      return { success: false, error: `Rolling entry not found: ${manifest.rolling.entry}` };
    }

    try {
      const result = spawnSync(process.execPath, [...process.execArgv, setupPath], {
        cwd: store.packageDir(name),
        stdio: 'inherit',
      });

      if (result.status !== 0) {
        return { success: false, error: `Rolling setup exited with code ${result.status}` };
      }

      return {
        success: true,
        data: { message: `Rolling setup for "${name}" completed.`, package: name },
      };
    } catch (err) {
      return { success: false, error: `Rolling failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // --- put ---
  function put(args: string[]): Result {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary put <package>' };

    if (!store.isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

    const manifest = store.getManifest(name)!;
    if (manifest.type !== 'extension') {
      return { success: false, error: `Package "${name}" is type "${manifest.type || 'script'}", not an extension. Script packages don't need \`put\`.` };
    }

    if (store.isExtensionActive(name)) {
      return { success: true, data: { message: `Extension "${name}" is already active.`, package: name } };
    }

    store.activateExtension(name);

    return {
      success: true,
      data: {
        message: `Extension "${name}" is now active. Larry's ready to play.`,
        package: name,
        hooks: manifest.hooks ? Object.keys(manifest.hooks) : [],
      },
    };
  }

  // --- yoink ---
  function yoink(args: string[]): Result {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary yoink <package>' };

    if (!store.isExtensionActive(name)) {
      return { success: false, error: `Extension "${name}" is not active.` };
    }

    store.deactivateExtension(name);

    return {
      success: true,
      data: { message: `Extension "${name}" deactivated. Toy's back in the box.`, package: name },
    };
  }

  // --- need-repair ---
  function needRepair(): Result {
    const issues = store.checkRepair();

    if (issues.length === 0) {
      return { success: true, data: { message: 'All toys are in good shape.', issues: [] } };
    }

    return {
      success: true,
      data: { message: `Found ${issues.length} issue(s) that need repair:`, issues },
      warnings: issues.map(i => `${i.package}: ${i.issue}`),
    };
  }

  // --- Router ---
  async function router(args: string[]): Promise<Result> {
    const subcommand = args[0];
    const rest = args.slice(1);

    switch (subcommand) {
      case 'get':          return get(rest);
      case 'toybox':       return toybox();
      case 'peek':         return peek(rest);
      case 'destroy':      return destroy(rest);
      case 'kick':         return destroy(rest);
      case 'rolling':      return rolling(rest);
      case 'put':          return put(rest);
      case 'yoink':        return yoink(rest);
      case 'need-repair':  return needRepair();

      case undefined:
      case 'help':
        return {
          success: true,
          data: {
            message: `Larry the Cat — Package & Extension Manager

Usage: pw rary <command> [args...]

Commands:
  get <repo|path>      Fetch a toy into the toybox
  toybox               List installed packages
  peek <package>       Inspect a package
  put <package>        Activate an extension
  yoink <package>      Deactivate an extension (keep installed)
  rolling <package>    Run first-time setup
  destroy <package>    Remove a package
  kick <package>       Remove a package (alias for destroy)
  need-repair          Check for broken packages
  help                 Show this help`,
          },
        };

      default:
        return { success: false, error: `Unknown rary command: ${subcommand}. Run \`pw rary help\`.` };
    }
  }

  return { get, toybox, peek, destroy, rolling, put, yoink, needRepair, router };
}

// --- Default instance (production) ---

const GLOBAL_STATE = join(homedir(), '.playwright-state');
const defaultStore = createRaryStore({
  toyboxDir: join(GLOBAL_STATE, 'toybox'),
  extensionsFile: join(GLOBAL_STATE, 'extensions.json'),
});
const defaultCommands = createRaryCommands(defaultStore);

// Backward-compatible exports
export const raryGet = defaultCommands.get;
export const raryToybox = defaultCommands.toybox;
export const raryPeek = defaultCommands.peek;
export const raryDestroy = defaultCommands.destroy;
export const raryRolling = defaultCommands.rolling;
export const raryPut = defaultCommands.put;
export const raryYoink = defaultCommands.yoink;
export const raryNeedRepair = defaultCommands.needRepair;
export const raryRouter = defaultCommands.router;
