// rary-commands.ts — CLI handlers for pw rary subcommands
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  packageDir,
  getManifest,
  isInstalled,
  listPackages,
  removePackage,
  isExtensionActive,
  activateExtension,
  deactivateExtension,
  checkRepair,
  TOYBOX_DIR,
  type LarryManifest,
} from './rary.js';

interface Result {
  success: boolean;
  data?: any;
  error?: string;
  warnings?: string[];
}

// --- get <repo> ---

export async function raryGet(args: string[]): Promise<Result> {
  const repo = args[0];
  if (!repo) return { success: false, error: 'Usage: pw rary get <repo|path>' };

  if (!existsSync(TOYBOX_DIR)) mkdirSync(TOYBOX_DIR, { recursive: true });

  // Determine package name from repo
  const repoName = repo.split('/').pop()?.replace(/\.git$/, '') || repo;

  if (isInstalled(repoName)) {
    return { success: false, error: `Package "${repoName}" already installed. Use \`pw rary destroy ${repoName}\` first.` };
  }

  const targetDir = packageDir(repoName);

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
    // Git clone
    try {
      const gitUrl = repo.includes('://') ? repo : `https://github.com/${repo}.git`;
      execSync(`git clone --depth 1 "${gitUrl}" "${targetDir}"`, { stdio: 'ignore' });
    } catch (err) {
      return { success: false, error: `Failed to clone "${repo}": ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const manifest = getManifest(repoName);

  // Install npm dependencies if package.json exists
  const pkgJson = join(targetDir, 'package.json');
  if (existsSync(pkgJson)) {
    try {
      execSync('npm install --production', { cwd: targetDir, stdio: 'ignore' });
    } catch {}
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

export function raryToybox(): Result {
  const packages = listPackages();

  const list = packages.map(({ name, manifest }) => ({
    name,
    version: manifest?.version || 'unknown',
    type: manifest?.type || 'script',
    description: manifest?.description || '',
    active: isExtensionActive(name),
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

export function raryPeek(args: string[]): Result {
  const name = args[0];
  if (!name) return { success: false, error: 'Usage: pw rary peek <package>' };

  if (!isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

  const manifest = getManifest(name)!;
  const active = isExtensionActive(name);

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

// --- destroy / kick <package> ---

export function raryDestroy(args: string[]): Result {
  const name = args[0];
  if (!name) return { success: false, error: 'Usage: pw rary destroy <package>' };

  if (!existsSync(packageDir(name))) {
    return { success: false, error: `Package "${name}" not found in toybox.` };
  }

  const wasActive = isExtensionActive(name);
  removePackage(name);

  return {
    success: true,
    data: {
      message: `Toy "${name}" has been removed from the toybox.`,
      package: name,
      wasActive,
    },
  };
}

// --- rolling <package> ---

export async function raryRolling(args: string[]): Promise<Result> {
  const name = args[0];
  if (!name) return { success: false, error: 'Usage: pw rary rolling <package>' };

  if (!isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

  const manifest = getManifest(name)!;
  if (!manifest.rolling?.entry) {
    return { success: false, error: `Package "${name}" has no rolling (setup) entry defined.` };
  }

  const setupPath = join(packageDir(name), manifest.rolling.entry);
  if (!existsSync(setupPath)) {
    return { success: false, error: `Rolling entry not found: ${manifest.rolling.entry}` };
  }

  try {
    const result = spawnSync(process.execPath, [...process.execArgv, setupPath], {
      cwd: packageDir(name),
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      return { success: false, error: `Rolling setup exited with code ${result.status}` };
    }

    return {
      success: true,
      data: {
        message: `Rolling setup for "${name}" completed.`,
        package: name,
      },
    };
  } catch (err) {
    return { success: false, error: `Rolling failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// --- put <package> ---

export function raryPut(args: string[]): Result {
  const name = args[0];
  if (!name) return { success: false, error: 'Usage: pw rary put <package>' };

  if (!isInstalled(name)) return { success: false, error: `Package "${name}" not found in toybox.` };

  const manifest = getManifest(name)!;
  if (manifest.type !== 'extension') {
    return {
      success: false,
      error: `Package "${name}" is type "${manifest.type || 'script'}", not an extension. Script packages don't need \`put\`.`,
    };
  }

  if (isExtensionActive(name)) {
    return { success: true, data: { message: `Extension "${name}" is already active.`, package: name } };
  }

  activateExtension(name);

  return {
    success: true,
    data: {
      message: `Extension "${name}" is now active. Larry's ready to play.`,
      package: name,
      hooks: manifest.hooks ? Object.keys(manifest.hooks) : [],
    },
  };
}

// --- yoink <package> (deactivate without destroy) ---

export function raryYoink(args: string[]): Result {
  const name = args[0];
  if (!name) return { success: false, error: 'Usage: pw rary yoink <package>' };

  if (!isExtensionActive(name)) {
    return { success: false, error: `Extension "${name}" is not active.` };
  }

  deactivateExtension(name);

  return {
    success: true,
    data: {
      message: `Extension "${name}" deactivated. Toy's back in the box.`,
      package: name,
    },
  };
}

// --- need-repair ---

export function raryNeedRepair(): Result {
  const issues = checkRepair();

  if (issues.length === 0) {
    return {
      success: true,
      data: { message: 'All toys are in good shape.', issues: [] },
    };
  }

  return {
    success: true,
    data: {
      message: `Found ${issues.length} issue(s) that need repair:`,
      issues,
    },
    warnings: issues.map(i => `${i.package}: ${i.issue}`),
  };
}

// --- Router ---

export async function raryRouter(args: string[]): Promise<Result> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case 'get':          return raryGet(rest);
    case 'toybox':       return raryToybox();
    case 'peek':         return raryPeek(rest);
    case 'destroy':      return raryDestroy(rest);
    case 'kick':         return raryDestroy(rest); // alias
    case 'rolling':      return raryRolling(rest);
    case 'put':          return raryPut(rest);
    case 'yoink':        return raryYoink(rest);
    case 'need-repair':  return raryNeedRepair();

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
