// browser-command.ts — `pw browser <register|list|remove|search>`: manage the
// registry of browser binaries that `pw launch --browser=<name>` resolves.
import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { registerBrowser, unregisterBrowser, readBrowserRegistryScoped } from './browser-registry.js';

function parseFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function readVersion(path: string): string | null {
  try {
    return execFileSync(path, ['--version'], { encoding: 'utf-8', timeout: 4000 }).trim();
  } catch {
    return null;
  }
}

type Result = { success: boolean; data?: any; error?: string };

export function listBrowsersCommand(): Result {
  const browsers = readBrowserRegistryScoped().map(({ name, scope, entry }) => ({
    name,
    scope,
    path: entry.path,
    label: entry.label ?? null,
    defaultName: entry.defaultName ?? null,
    installed: existsSync(entry.path),
    version: existsSync(entry.path) ? readVersion(entry.path) : null,
  }));
  return {
    success: true,
    data: {
      count: browsers.length,
      browsers,
      ...(browsers.length ? {} : { note: 'No browsers registered. Add one: pw browser register <name> <path> (find candidates with `pw browser search`).' }),
    },
  };
}

// --- search: scan the Applications folders for browser-looking .app bundles ---
const BROWSERY = /chrome|chromium|brave|edge|vivaldi|arc|opera|browser/i;

function launcherBinary(appPath: string): string | null {
  const base = appPath.split('/').pop()!.replace(/\.app$/, '');
  const guess = join(appPath, 'Contents', 'MacOS', base);
  if (existsSync(guess)) return guess;
  try {
    const macos = join(appPath, 'Contents', 'MacOS');
    const files = readdirSync(macos);
    if (files.length) return join(macos, files[0]);
  } catch {
    /* not a mac app bundle */
  }
  return null;
}

function searchBrowsers(query?: string): Array<{ app: string; path: string; version: string | null }> {
  const dirs = ['/Applications', join(homedir(), 'Applications')];
  const out: Array<{ app: string; path: string; version: string | null }> = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.app')) continue;
      const matches = query ? name.toLowerCase().includes(query.toLowerCase()) : BROWSERY.test(name);
      if (!matches) continue;
      const bin = launcherBinary(join(dir, name));
      if (bin) out.push({ app: name.replace(/\.app$/, ''), path: bin, version: readVersion(bin) });
    }
  }
  return out;
}

export function browserRouter(args: string[]): Result {
  const positionals = args.filter(a => !a.startsWith('--'));
  const sub = positionals[0];

  switch (sub) {
    case 'register': {
      const [, name, path] = positionals;
      if (!name || !path) {
        return { success: false, error: 'Usage: pw browser register <name> <path> [--name=<defaultSession>] [--label=<L>] [--global]' };
      }
      try {
        const global = hasFlag(args, 'global');
        const entry = registerBrowser(name, path, { label: parseFlag(args, 'label'), defaultName: parseFlag(args, 'name'), global });
        return { success: true, data: { registered: name, scope: global ? 'global' : 'local', ...entry } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    case 'remove':
    case 'unregister': {
      const name = positionals[1];
      if (!name) return { success: false, error: 'Usage: pw browser remove <name> [--global]' };
      const global = hasFlag(args, 'global');
      const removed = unregisterBrowser(name, { global });
      return removed
        ? { success: true, data: { removed: name, scope: global ? 'global' : 'local' } }
        : { success: false, error: `"${name}" is not registered in the ${global ? 'global' : 'local'} registry.` };
    }
    case 'search': {
      const candidates = searchBrowsers(positionals[1]);
      return {
        success: true,
        data: {
          count: candidates.length,
          candidates,
          hint: candidates.length
            ? 'Register one with: pw browser register <name> <path>'
            : 'No matches in /Applications. Register a binary directly: pw browser register <name> </path/to/binary>.',
        },
      };
    }
    case 'list':
    case undefined:
      return listBrowsersCommand();
    default:
      return { success: false, error: `Unknown subcommand "pw browser ${sub}". Use: register | list | remove | search.` };
  }
}
