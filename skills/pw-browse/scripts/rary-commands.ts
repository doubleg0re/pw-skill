// rary-commands.ts — CLI handlers for pw rary subcommands
// Accepts a RaryStore for testability. Production uses default store.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
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

type FlavorLines = string[];
type FlavorKind = 'yoink' | 'snub' | 'kick' | 'pet';
type LarryStatusPose = 'watching_human' | 'curled_up_sleeping' | 'belly_up_sleeping' | 'loaf' | 'typing_name';

const FLAVOR_PRESETS: Record<FlavorKind, (name: string) => FlavorLines[]> = {
  yoink: (name) => [
    [
      `Larry is eyeing "${name}".`,
      `Larry yoinked it into the toybox. Meow.`,
    ],
    [
      `Larry lifted his butt and gave "${name}" the classic wiggle.`,
      `Then he pounced and yoinked it straight into the toybox.`,
    ],
    [
      `Larry padded over to "${name}".`,
      `Now "${name}" is tucked into the toybox.`,
    ],
    [
      `Larry spotted "${name}" from across the room.`,
      `A quick yoink later, it is in the toybox.`,
    ],
  ],
  snub: (name) => [
    [
      `Larry lost interest in "${name}".`,
      `It is being ignored for now.`,
    ],
    [
      `Larry gave "${name}" a long blink and looked away.`,
      `That toy is ignored until further notice.`,
    ],
    [
      `Larry decided "${name}" is beneath notice today.`,
      `It is now ignored.`,
    ],
  ],
  kick: (name) => [
    [
      `Larry batted "${name}" out of the toybox.`,
      `It is gone for good.`,
    ],
    [
      `Larry kicked "${name}" clean out of bounds.`,
      `The toybox is lighter now.`,
    ],
    [
      `Larry sent "${name}" flying past the toybox wall.`,
      `That one will not be coming back.`,
    ],
  ],
  pet: () => [
    [
      `Larry leans into your hand.`,
      `A low purr fills the live-rary.`,
    ],
    [
      `Larry accepts the petting with professional dignity.`,
      `The purring is immediate.`,
    ],
    [
      `Larry gives you a slow blink.`,
      `Then comes the steady purr.`,
    ],
  ],
};

function pickFlavor(kind: FlavorKind, name: string): FlavorLines {
  const presets = FLAVOR_PRESETS[kind](name);
  return presets[Math.floor(Math.random() * presets.length)]!;
}

const STATUS_PRESETS: Array<{ pose: LarryStatusPose; flavor: FlavorLines }> = [
  {
    pose: 'watching_human',
    flavor: [
      'Larry is staring directly at his human.',
      'This appears deliberate.',
    ],
  },
  {
    pose: 'curled_up_sleeping',
    flavor: [
      'Larry is curled into a neat circle.',
      'He is fully asleep and unavailable for package management.',
    ],
  },
  {
    pose: 'belly_up_sleeping',
    flavor: [
      'Larry is asleep with his belly on display.',
      'Operational security is currently very low.',
    ],
  },
  {
    pose: 'loaf',
    flavor: [
      'Larry is in full loaf mode.',
      'Paws are tucked. Systems are nominal.',
    ],
  },
  {
    pose: 'typing_name',
    flavor: [
      'Larry is typing his name.',
      '"R, A, R, Y" ... Rary.',
    ],
  },
];

function pickStatus(): { pose: LarryStatusPose; flavor: FlavorLines } {
  return STATUS_PRESETS[Math.floor(Math.random() * STATUS_PRESETS.length)]!;
}

// --- Factory: create commands bound to a store ---

export function createRaryCommands(store: RaryStore) {

  // --- get <repo> ---
  async function get(args: string[], flavorKind?: FlavorKind): Promise<Result> {
    const input = args[0];
    if (!input) return { success: false, error: 'Usage: pw rary get <repo|path> [--source] [--build]\n  Subdir syntax: owner/repo//subdir or ./path//subdir' };

    const isSource = args.includes('--source');
    const isBuild = args.includes('--build');

    if (!existsSync(store.toyboxDir)) mkdirSync(store.toyboxDir, { recursive: true });

    // Parse repo//subdir syntax
    const doubleslashIdx = input.indexOf('//');
    const repoSpec = doubleslashIdx >= 0 ? input.slice(0, doubleslashIdx) : input;
    const subdir = doubleslashIdx >= 0 ? input.slice(doubleslashIdx + 2) : null;

    if (subdir !== null && !subdir) {
      return { success: false, error: 'Invalid syntax: subdir after // must not be empty. Example: owner/repo//pw-monitor' };
    }

    // Determine package name (may be overridden by manifest.name later)
    let pkgName = subdir ? basename(subdir) : basename(repoSpec).replace(/\.git$/, '') || repoSpec;

    if (store.isInstalled(pkgName)) {
      return { success: false, error: `Package "${pkgName}" already installed. Use \`pw rary destroy ${pkgName}\` first.` };
    }

    // --- Fetch repo/path into temp or target ---

    let sourceDir: string; // where the package files are before copying to toybox
    let tempDir: string | null = null;

    if (existsSync(repoSpec)) {
      // Local path
      const absPath = resolve(repoSpec);
      if (subdir) {
        const subdirPath = join(absPath, subdir);
        if (!existsSync(subdirPath)) {
          return { success: false, error: `Subdir "${subdir}" not found in "${absPath}"` };
        }
        sourceDir = subdirPath;
      } else {
        sourceDir = absPath;
      }
    } else {
      // Git clone to temp
      const { tmpdir } = await import('os');
      const { randomBytes } = await import('crypto');
      tempDir = join(tmpdir(), `rary-get-${randomBytes(4).toString('hex')}`);
      const gitUrl = repoSpec.includes('://') ? repoSpec : `https://github.com/${repoSpec}.git`;
      const cloneResult = spawnSync('git', ['clone', '--depth', '1', gitUrl, tempDir], { stdio: 'ignore' });
      if (cloneResult.status !== 0) {
        return { success: false, error: `Failed to clone "${repoSpec}" (exit code ${cloneResult.status})` };
      }

      if (subdir) {
        const subdirPath = join(tempDir, subdir);
        if (!existsSync(subdirPath)) {
          cleanupTemp(tempDir);
          return { success: false, error: `Subdir "${subdir}" not found in cloned repo "${repoSpec}"` };
        }
        sourceDir = subdirPath;
      } else {
        sourceDir = tempDir;
      }
    }

    // Validate larry.json exists in source
    const manifestPath = join(sourceDir, 'larry.json');
    if (!existsSync(manifestPath)) {
      if (tempDir) cleanupTemp(tempDir);
      return { success: false, error: `No larry.json found in ${subdir ? `"${subdir}" subdirectory of ` : ''}"${repoSpec}". Not a valid rary package.` };
    }

    // Read manifest to resolve package name
    try {
      const manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifestData.name && typeof manifestData.name === 'string') {
        // Check if manifest name differs from directory-derived name
        if (manifestData.name !== pkgName) {
          // Use manifest name, but check for conflicts
          if (store.isInstalled(manifestData.name)) {
            if (tempDir) cleanupTemp(tempDir);
            return { success: false, error: `Package "${manifestData.name}" (from manifest) already installed. Use \`pw rary destroy ${manifestData.name}\` first.` };
          }
          pkgName = manifestData.name;
        }
      }
    } catch {}

    // Copy package to toybox
    const targetDir = store.packageDir(pkgName);
    const copyResult = process.platform === 'win32'
      ? spawnSync('xcopy', [sourceDir, targetDir, '/E', '/I', '/Q'], { stdio: 'ignore' })
      : spawnSync('cp', ['-r', sourceDir, targetDir], { stdio: 'ignore' });

    if (tempDir) cleanupTemp(tempDir);

    if (copyResult.status !== 0) {
      return { success: false, error: `Failed to copy package to toybox (exit code ${copyResult.status})` };
    }
    if (!existsSync(targetDir)) {
      return { success: false, error: `Copy appeared to succeed but target directory not found: ${targetDir}` };
    }

    const manifest = store.getManifest(pkgName);

    // Install npm dependencies if package.json exists
    const pkgJson = join(targetDir, 'package.json');
    if (existsSync(pkgJson)) {
      spawnSync('npm', ['install', '--production'], { cwd: targetDir, stdio: 'ignore' });
    }

    // --build: trigger rolling/setup if available
    let buildResult: string | undefined;
    if (isBuild) {
      if (manifest?.rolling) {
        buildResult = `Run \`pw rary rolling ${pkgName}\` to complete setup.`;
      } else if (existsSync(pkgJson)) {
        const buildRun = spawnSync('npm', ['run', 'build', '--if-present'], { cwd: targetDir, stdio: 'ignore' });
        buildResult = buildRun.status === 0 ? 'Build completed.' : 'Build script not found or failed.';
      } else {
        buildResult = 'No build/setup path found for this package.';
      }
    }

    return {
      success: true,
      data: {
        message: `Fetched toy "${pkgName}" into the toybox.`,
        package: pkgName,
        ...(subdir ? { subdir } : {}),
        ...(isSource ? { mode: 'source' } : {}),
        ...(buildResult ? { build: buildResult } : {}),
        manifest: manifest ? { name: manifest.name, version: manifest.version, type: manifest.type, description: manifest.description } : null,
        hint: manifest?.rolling ? `Run \`pw rary rolling ${pkgName}\` for first-time setup.` : undefined,
        ...(flavorKind ? { flavor: pickFlavor(flavorKind, pkgName) } : {}),
      },
    };
  }

  function cleanupTemp(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
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
  function destroy(args: string[], flavorKind?: FlavorKind): Result {
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
        ...(flavorKind ? { flavor: pickFlavor(flavorKind, name) } : {}),
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

  // --- ignore ---
  function ignore(args: string[], flavorKind?: FlavorKind): Result {
    const name = args[0];
    if (!name) return { success: false, error: 'Usage: pw rary ignore <package>' };

    if (!store.isExtensionActive(name)) {
      return { success: false, error: `Extension "${name}" is not active.` };
    }

    store.deactivateExtension(name);

    return {
      success: true,
      data: {
        message: `Extension "${name}" deactivated. Toy's back in the box.`,
        package: name,
        ...(flavorKind ? { flavor: pickFlavor(flavorKind, name) } : {}),
      },
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

  // Easter egg commands are for curious operators and AI tooling only.
  // Keep them out of help/docs; they do not affect package integrity.
  function pet(): Result {
    return {
      success: true,
      data: {
        message: 'Larry is purring.',
        flavor: pickFlavor('pet', 'Larry'),
      },
    };
  }

  function status(): Result {
    const current = pickStatus();
    return {
      success: true,
      data: {
        message: 'Larry status report.',
        pose: current.pose,
        flavor: current.flavor,
      },
    };
  }

  // --- Router ---
  async function router(args: string[]): Promise<Result> {
    const subcommand = args[0];
    const rest = args.slice(1);

    switch (subcommand) {
      case 'get':          return get(rest);
      case 'yoink':        return get(rest, 'yoink');
      case 'toybox':       return toybox();
      case 'peek':         return peek(rest);
      case 'destroy':      return destroy(rest);
      case 'kick':         return destroy(rest, 'kick');
      case 'rolling':      return rolling(rest);
      case 'put':          return put(rest);
      case 'ignore':       return ignore(rest);
      case 'snub':         return ignore(rest, 'snub');
      case 'need-repair':  return needRepair();
      case 'pet':          return pet();
      case 'status':       return status();

      case undefined:
      case 'help':
        return {
          success: true,
          data: {
            message: `Larry the Cat — Larry's Live-rary (Package & Extension Manager)

Usage: pw rary <command> [args...]

Commands:
  get <repo|path>      Fetch a toy into the toybox (alias: yoink)
  toybox               List installed packages
  peek <package>       Inspect a package
  put <package>        Activate an extension
  ignore <package>     Deactivate an extension (alias: snub)
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

  return { get, yoink: get, toybox, peek, destroy, rolling, put, ignore, snub: ignore, needRepair, router };
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
export const raryYoink = defaultCommands.get;
export const raryIgnore = defaultCommands.ignore;
export const rarySnub = defaultCommands.ignore;
export const raryNeedRepair = defaultCommands.needRepair;
export const raryRouter = defaultCommands.router;
