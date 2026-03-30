import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRaryStore,
  type RaryStore,
  type LarryManifest,
} from '../skills/pw-browse/scripts/rary.js';
import {
  createRaryCommands,
} from '../skills/pw-browse/scripts/rary-commands.js';

const TEST_DIR = join(tmpdir(), `pw-rary-test-${Date.now()}`);
const TOYBOX_DIR = join(TEST_DIR, 'toybox');
const EXTENSIONS_FILE = join(TEST_DIR, 'extensions.json');

let store: RaryStore;

function setup() {
  store = createRaryStore({ toyboxDir: TOYBOX_DIR, extensionsFile: EXTENSIONS_FILE });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

/** Create a package directly in toybox (simulates `rary get`) */
function seedPackage(name: string, manifest: LarryManifest, files?: Record<string, string>) {
  const dir = join(TOYBOX_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'larry.json'), JSON.stringify(manifest, null, 2));
  if (files) {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(dir, path);
      const parent = join(fullPath, '..');
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
}

// --- CRUD ---

describe('RaryStore — createRaryStore / getManifest', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('reads manifest from package', () => {
    seedPackage('hello', { name: 'hello', version: '1.0.0', description: 'test' });
    const manifest = store.getManifest('hello');
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe('hello');
    expect(manifest!.version).toBe('1.0.0');
  });

  it('returns null for missing package', () => {
    expect(store.getManifest('ghost')).toBeNull();
  });

  it('isInstalled checks both directory and manifest', () => {
    seedPackage('valid', { name: 'valid', version: '1.0.0' });
    expect(store.isInstalled('valid')).toBe(true);
    expect(store.isInstalled('missing')).toBe(false);

    // Directory exists but no larry.json
    mkdirSync(join(TOYBOX_DIR, 'no-manifest'), { recursive: true });
    expect(store.isInstalled('no-manifest')).toBe(false);
  });
});

describe('RaryStore — listPackages', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('lists all packages', () => {
    seedPackage('a', { name: 'a', version: '1.0.0' });
    seedPackage('b', { name: 'b', version: '2.0.0' });
    const pkgs = store.listPackages();
    expect(pkgs).toHaveLength(2);
    expect(pkgs.map(p => p.name).sort()).toEqual(['a', 'b']);
  });

  it('returns empty for empty toybox', () => {
    expect(store.listPackages()).toEqual([]);
  });

  it('includes packages with missing manifest', () => {
    mkdirSync(join(TOYBOX_DIR, 'broken'), { recursive: true });
    const pkgs = store.listPackages();
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].manifest).toBeNull();
  });
});

describe('RaryStore — removePackage', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('removes package directory', () => {
    seedPackage('doomed', { name: 'doomed', version: '1.0.0' });
    store.removePackage('doomed');
    expect(existsSync(join(TOYBOX_DIR, 'doomed'))).toBe(false);
  });

  it('also deactivates if active', () => {
    seedPackage('ext', { name: 'ext', version: '1.0.0', type: 'extension' });
    store.activateExtension('ext');
    expect(store.isExtensionActive('ext')).toBe(true);
    store.removePackage('ext');
    expect(store.isExtensionActive('ext')).toBe(false);
  });

  it('no error for non-existent package', () => {
    expect(() => store.removePackage('ghost')).not.toThrow();
  });
});

// --- Extension activation ---

describe('RaryStore — activation lifecycle', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('activate → isActive → deactivate → not active', () => {
    seedPackage('ext', { name: 'ext', version: '1.0.0', type: 'extension' });
    expect(store.isExtensionActive('ext')).toBe(false);

    store.activateExtension('ext');
    expect(store.isExtensionActive('ext')).toBe(true);

    store.deactivateExtension('ext');
    expect(store.isExtensionActive('ext')).toBe(false);
  });

  it('getActiveExtensions returns activated ones', () => {
    seedPackage('a', { name: 'a', version: '1.0.0', type: 'extension' });
    seedPackage('b', { name: 'b', version: '1.0.0', type: 'extension' });
    store.activateExtension('a');
    const active = store.getActiveExtensions();
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('a');
  });

  it('multiple extensions can be active', () => {
    seedPackage('a', { name: 'a', version: '1.0.0', type: 'extension' });
    seedPackage('b', { name: 'b', version: '1.0.0', type: 'extension' });
    store.activateExtension('a');
    store.activateExtension('b');
    expect(store.getActiveExtensions()).toHaveLength(2);
  });

  it('deactivating non-active is a no-op', () => {
    expect(() => store.deactivateExtension('nothing')).not.toThrow();
  });
});

// --- Repair ---

describe('RaryStore — checkRepair', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('no issues for healthy package', () => {
    seedPackage('good', {
      name: 'good', version: '1.0.0', entry: 'index.js',
      commands: [{ name: 'hello', entry: 'hello.js' }],
    }, { 'index.js': 'export default {}', 'hello.js': 'console.log("hi")' });
    expect(store.checkRepair()).toEqual([]);
  });

  it('detects missing larry.json', () => {
    mkdirSync(join(TOYBOX_DIR, 'broken'), { recursive: true });
    const issues = store.checkRepair();
    expect(issues.some(i => i.package === 'broken' && i.issue.includes('larry.json'))).toBe(true);
  });

  it('detects missing entry file', () => {
    seedPackage('bad', { name: 'bad', version: '1.0.0', entry: 'missing.js' });
    const issues = store.checkRepair();
    expect(issues.some(i => i.issue.includes('missing.js'))).toBe(true);
  });

  it('detects missing hook entry', () => {
    seedPackage('bad-hooks', {
      name: 'bad-hooks', version: '1.0.0', type: 'extension',
      hooks: { launch: { entry: 'hooks/launch.js' } },
    });
    const issues = store.checkRepair();
    expect(issues.some(i => i.issue.includes('hooks/launch.js'))).toBe(true);
  });

  it('detects missing command entry', () => {
    seedPackage('bad-cmd', {
      name: 'bad-cmd', version: '1.0.0',
      commands: [{ name: 'go', entry: 'go.js' }],
    });
    const issues = store.checkRepair();
    expect(issues.some(i => i.issue.includes('go') && i.issue.includes('go.js'))).toBe(true);
  });

  it('detects ghost extension (active but not installed)', () => {
    store.activateExtension('ghost');
    const issues = store.checkRepair();
    expect(issues.some(i => i.package === 'ghost' && i.issue.includes('not installed'))).toBe(true);
  });

  it('detects missing rolling entry', () => {
    seedPackage('bad-rolling', {
      name: 'bad-rolling', version: '1.0.0',
      rolling: { entry: 'setup.js' },
    });
    const issues = store.checkRepair();
    expect(issues.some(i => i.issue.includes('setup.js'))).toBe(true);
  });
});

// --- Command router (injected store — no global filesystem side effects) ---

describe('rary commands (injected store)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  function cmds() {
    return createRaryCommands(store);
  }

  it('help returns Larry banner', async () => {
    const result = await cmds().router(['help']);
    expect(result.success).toBe(true);
    expect(result.data.message).toContain('Larry the Cat');
    expect(result.data.message).not.toContain('pet');
    expect(result.data.message).not.toContain('status');
  });

  it('unknown command returns error', async () => {
    const result = await cmds().router(['nonexistent']);
    expect(result.success).toBe(false);
  });

  it('all commands require arguments', async () => {
    const c = cmds();
    for (const cmd of ['get', 'yoink', 'peek', 'destroy', 'rolling', 'put', 'ignore', 'snub']) {
      const result = await c.router([cmd]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage');
    }
  });

  it('toybox lists seeded packages', async () => {
    seedPackage('hello', { name: 'hello', version: '1.0.0', description: 'hi' });
    const result = cmds().toybox();
    expect(result.success).toBe(true);
    expect(result.data.packages).toHaveLength(1);
    expect(result.data.packages[0].name).toBe('hello');
  });

  it('toybox returns empty message for empty toybox', async () => {
    const result = cmds().toybox();
    expect(result.data.packages).toHaveLength(0);
    expect(result.data.message).toContain('empty');
  });

  it('peek shows package details', async () => {
    seedPackage('pkg', {
      name: 'pkg', version: '2.0.0', type: 'extension', description: 'test ext',
      commands: [{ name: 'do', entry: 'do.js' }],
      hooks: { launch: { entry: 'hooks/launch.js' } },
    });
    const result = cmds().peek(['pkg']);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('pkg');
    expect(result.data.version).toBe('2.0.0');
    expect(result.data.type).toBe('extension');
    expect(result.data.commands).toHaveLength(1);
    expect(result.data.hooks).toContain('launch');
  });

  it('peek fails for missing package', () => {
    const result = cmds().peek(['ghost']);
    expect(result.success).toBe(false);
  });

  it('put activates extension', () => {
    seedPackage('ext', { name: 'ext', version: '1.0.0', type: 'extension' });
    const c = cmds();
    expect(store.isExtensionActive('ext')).toBe(false);
    const result = c.put(['ext']);
    expect(result.success).toBe(true);
    expect(store.isExtensionActive('ext')).toBe(true);
  });

  it('put rejects non-extension packages', () => {
    seedPackage('script', { name: 'script', version: '1.0.0', type: 'script' });
    const result = cmds().put(['script']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not an extension');
  });

  it('ignore deactivates extension', () => {
    seedPackage('ext', { name: 'ext', version: '1.0.0', type: 'extension' });
    store.activateExtension('ext');
    const result = cmds().ignore(['ext']);
    expect(result.success).toBe(true);
    expect(store.isExtensionActive('ext')).toBe(false);
    expect(result.data.flavor).toBeUndefined();
  });

  it('snub remains as alias for ignore', async () => {
    seedPackage('ext', { name: 'ext', version: '1.0.0', type: 'extension' });
    store.activateExtension('ext');
    const result = await cmds().router(['snub', 'ext']);
    expect(result.success).toBe(true);
    expect(store.isExtensionActive('ext')).toBe(false);
    expect(result.data.flavor).toBeTruthy();
    expect(Array.isArray(result.data.flavor)).toBe(true);
  });

  it('destroy removes package and deactivates', () => {
    seedPackage('bye', { name: 'bye', version: '1.0.0', type: 'extension' });
    store.activateExtension('bye');
    const result = cmds().destroy(['bye']);
    expect(result.success).toBe(true);
    expect(result.data.wasActive).toBe(true);
    expect(store.isInstalled('bye')).toBe(false);
    expect(store.isExtensionActive('bye')).toBe(false);
  });

  it('kick is alias for destroy', async () => {
    seedPackage('kicked', { name: 'kicked', version: '1.0.0' });
    const result = await cmds().router(['kick', 'kicked']);
    expect(result.success).toBe(true);
    expect(store.isInstalled('kicked')).toBe(false);
    expect(result.data.flavor).toBeTruthy();
    expect(Array.isArray(result.data.flavor)).toBe(true);
  });

  it('need-repair detects ghost extension', () => {
    store.activateExtension('ghost');
    const result = cmds().needRepair();
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('ghost'))).toBe(true);
  });

  it('need-repair passes for healthy toybox', () => {
    seedPackage('good', { name: 'good', version: '1.0.0', entry: 'index.js' }, { 'index.js': 'export default {}' });
    const result = cmds().needRepair();
    expect(result.data.issues).toHaveLength(0);
  });

  it('pet is a hidden easter egg command', async () => {
    const result = await cmds().router(['pet']);
    expect(result.success).toBe(true);
    expect(result.data.message).toBe('Larry is purring.');
    expect(Array.isArray(result.data.flavor)).toBe(true);
  });

  it('status is a hidden easter egg command', async () => {
    const result = await cmds().router(['status']);
    expect(result.success).toBe(true);
    expect(result.data.message).toBe('Larry status report.');
    expect(['watching_human', 'curled_up_sleeping', 'belly_up_sleeping', 'loaf', 'typing_name']).toContain(result.data.pose);
    expect(Array.isArray(result.data.flavor)).toBe(true);
  });

  it('get with local path installs package', async () => {
    // Create a source package outside toybox
    const sourceDir = join(TEST_DIR, 'source-pkg');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'larry.json'), JSON.stringify({ name: 'source-pkg', version: '1.0.0' }));

    const result = await cmds().get([sourceDir]);
    expect(result.success).toBe(true);
    expect(store.isInstalled('source-pkg')).toBe(true);
    expect(result.data.flavor).toBeUndefined();
  });

  it('yoink remains as alias for get', async () => {
    const sourceDir = join(TEST_DIR, 'source-pkg-alias');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'larry.json'), JSON.stringify({ name: 'source-pkg-alias', version: '1.0.0' }));

    const result = await cmds().router(['yoink', sourceDir]);
    expect(result.success).toBe(true);
    expect(store.isInstalled('source-pkg-alias')).toBe(true);
    expect(result.data.flavor).toBeTruthy();
    expect(Array.isArray(result.data.flavor)).toBe(true);
  });
});
