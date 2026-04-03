// rary-commands.ts — CLI handlers for pw rary subcommands
// Accepts a RaryStore for testability. Production uses default store.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import {
  createRaryStore,
  type LarryManifest,
  type RaryStore,
  validateLarryManifest,
} from './rary.js';
import { homedir } from 'os';
import { ACTION_MAP } from './actions.js';

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

function formatManifestValidationError(issues: string[]): string {
  return [
    'Invalid larry.json:',
    ...issues.map(issue => `- ${issue}`),
  ].join('\n');
}

function findActivationConflicts(store: RaryStore, pkgName: string, manifest: LarryManifest): {
  builtinCollisions: string[];
  extensionCollisions: Array<{ actionName: string; packages: string[] }>;
} {
  const builtinCollisions = Object.keys(manifest.actions || {}).filter(actionName => actionName in ACTION_MAP);
  const activeOwners = new Map<string, string[]>();

  for (const { name, manifest: activeManifest } of store.getActiveExtensions()) {
    if (name === pkgName || !activeManifest?.actions) continue;
    for (const actionName of Object.keys(activeManifest.actions)) {
      const owners = activeOwners.get(actionName) || [];
      owners.push(name);
      activeOwners.set(actionName, owners);
    }
  }

  const extensionCollisions = Object.keys(manifest.actions || {})
    .map(actionName => ({
      actionName,
      packages: activeOwners.get(actionName) || [],
    }))
    .filter(conflict => conflict.packages.length > 0);

  return { builtinCollisions, extensionCollisions };
}

// --- Factory: create commands bound to a store ---

export function createRaryCommands(store: RaryStore) {

  // --- get <repo> ---
  // Built-in extension aliases → resolve to official pw-extensions repo
  const BUILTIN_EXTENSIONS: Record<string, string> = {
    'pw-monitor': 'doubleg0re/pw-extensions//pw-monitor',
    'pw-user-action': 'doubleg0re/pw-extensions//pw-user-action',
    'pw-ws-server': 'doubleg0re/pw-extensions//pw-ws-server',
  };

  async function get(args: string[], flavorKind?: FlavorKind): Promise<Result> {
    let input = args[0];
    if (!input) return { success: false, error: 'Usage: pw rary get <repo|path|builtin:name> [--source] [--build]\n  Subdir: owner/repo//subdir\n  Builtin: builtin:pw-monitor' };

    const isBuild = args.includes('--build');
    const isSource = args.includes('--source') || isBuild; // --build implies source

    // Resolve builtin: prefix
    if (input.startsWith('builtin:')) {
      const name = input.slice('builtin:'.length);
      const resolved = BUILTIN_EXTENSIONS[name];
      if (!resolved) {
        return { success: false, error: `Unknown builtin extension: "${name}". Available: ${Object.keys(BUILTIN_EXTENSIONS).join(', ')}` };
      }
      input = resolved;
    }

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

    // Read and validate manifest before copying to toybox
    let manifestData: LarryManifest;
    try {
      manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      if (tempDir) cleanupTemp(tempDir);
      return { success: false, error: `Invalid larry.json: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Schema validation + file existence check (skip file check for --build, files may not exist until after build)
    const preInstallIssues = validateLarryManifest(manifestData, isBuild ? undefined : { packageDir: sourceDir });
    if (preInstallIssues.length > 0) {
      if (tempDir) cleanupTemp(tempDir);
      return { success: false, error: formatManifestValidationError(preInstallIssues) };
    }

    if (manifestData.name !== pkgName) {
      pkgName = manifestData.name;
    }
    if (store.isInstalled(pkgName)) {
      if (tempDir) cleanupTemp(tempDir);
      return { success: false, error: `Package "${pkgName}" already installed. Use \`pw rary destroy ${pkgName}\` first.` };
    }

    // Copy package to toybox
    const targetDir = store.packageDir(pkgName);

    if (isSource) {
      // --source: copy everything
      const copyResult = process.platform === 'win32'
        ? spawnSync('xcopy', [sourceDir, targetDir, '/E', '/I', '/Q'], { stdio: 'ignore' })
        : spawnSync('cp', ['-r', sourceDir, targetDir], { stdio: 'ignore' });
      if (copyResult.status !== 0) {
        if (tempDir) cleanupTemp(tempDir);
        return { success: false, error: `Failed to copy package to toybox (exit code ${copyResult.status})` };
      }
    } else {
      // Default: copy runtime files only (dist + config), exclude source and tests
      mkdirSync(targetDir, { recursive: true });
      const { readdirSync, statSync, cpSync } = await import('fs');
      const EXCLUDE_DIRS = new Set(['src', 'tests', 'test', '.git']);
      for (const entry of readdirSync(sourceDir)) {
        const srcPath = join(sourceDir, entry);
        const destPath = join(targetDir, entry);
        if (EXCLUDE_DIRS.has(entry) && statSync(srcPath).isDirectory()) continue;
        cpSync(srcPath, destPath, { recursive: true });
      }
    }

    if (tempDir) cleanupTemp(tempDir);

    if (!existsSync(targetDir)) {
      return { success: false, error: `Copy appeared to succeed but target directory not found: ${targetDir}` };
    }

    const manifest = store.getManifest(pkgName);

    // Install npm dependencies if package.json exists
    const pkgJson = join(targetDir, 'package.json');
    if (existsSync(pkgJson)) {
      spawnSync('npm', ['install', '--production'], { cwd: targetDir, stdio: 'ignore' });
    }

    // --build: actually execute rolling/setup path
    let buildResult: string | undefined;
    let buildFailed = false;
    if (isBuild) {
      if (manifest?.rolling?.entry) {
        const rollingResult = await rolling([pkgName]);
        if (rollingResult.success) {
          buildResult = 'Build/setup completed via rolling.';
        } else {
          buildResult = `Rolling failed: ${rollingResult.error}`;
          buildFailed = true;
        }
      } else if (existsSync(pkgJson)) {
        // Check if package.json actually has a build script
        try {
          const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
          if (pkg.scripts?.build) {
            const buildRun = spawnSync('npm', ['run', 'build'], { cwd: targetDir, stdio: 'ignore' });
            if (buildRun.status === 0) {
              buildResult = 'Build completed.';
            } else {
              buildResult = 'Build script failed.';
              buildFailed = true;
            }
          } else {
            buildResult = 'No build script found in package.json.';
            buildFailed = true;
          }
        } catch {
          buildResult = 'Failed to read package.json.';
          buildFailed = true;
        }
      } else {
        buildResult = 'No build/setup path found for this package.';
        buildFailed = true;
      }
    }

    // Validate file existence against the final installed payload
    const fileIssues = validateLarryManifest(manifestData, { packageDir: targetDir });
    if (fileIssues.length > 0) {
      // Clean up broken install
      try { rmSync(targetDir, { recursive: true, force: true }); } catch {}
      return { success: false, error: formatManifestValidationError(fileIssues) };
    }

    return {
      success: !buildFailed,
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

    const manifestIssues = validateLarryManifest(manifest, { packageDir: store.packageDir(name) });
    if (manifestIssues.length > 0) {
      return { success: false, error: formatManifestValidationError(manifestIssues) };
    }

    if (store.isExtensionActive(name)) {
      return { success: true, data: { message: `Extension "${name}" is already active.`, package: name } };
    }

    const { builtinCollisions, extensionCollisions } = findActivationConflicts(store, name, manifest);
    if (builtinCollisions.length > 0) {
      return {
        success: false,
        error: [
          `Cannot activate extension "${name}" because it defines action names that collide with built-ins: ${builtinCollisions.join(', ')}`,
          'Rename those actions in larry.json and try again.',
        ].join('\n'),
      };
    }
    if (extensionCollisions.length > 0) {
      const conflictingPackages = [...new Set(extensionCollisions.flatMap(conflict => conflict.packages))];
      const guidance = conflictingPackages.length === 1
        ? `Run \`pw rary ignore ${conflictingPackages[0]}\` (or \`pw rary snub ${conflictingPackages[0]}\`) first, then retry \`pw rary put ${name}\`.`
        : `Ignore one of the conflicting extensions first with \`pw rary ignore <package>\` (or \`pw rary snub <package>\`), then retry \`pw rary put ${name}\`. Conflicting packages: ${conflictingPackages.map(pkg => `"${pkg}"`).join(', ')}.`;
      return {
        success: false,
        error: [
          `Cannot activate extension "${name}" because custom action names are already active:`,
          ...extensionCollisions.map(conflict => `- "${conflict.actionName}" is already provided by ${conflict.packages.map(pkg => `"${pkg}"`).join(', ')}`),
          guidance,
        ].join('\n'),
      };
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
