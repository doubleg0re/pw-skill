import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRaryStore,
  type RaryStore,
  type LarryManifest,
} from '../skills/pw-browse/scripts/rary.js';

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

// --- Command router ---

describe('rary command router', () => {
  it('help returns Larry banner', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['help']);
    expect(result.success).toBe(true);
    expect(result.data.message).toContain('Larry the Cat');
  });

  it('unknown command returns error', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['nonexistent']);
    expect(result.success).toBe(false);
  });

  it('get/peek/destroy require arguments', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    for (const cmd of ['get', 'peek', 'destroy', 'rolling', 'put', 'yoink']) {
      const result = await raryRouter([cmd]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Usage');
    }
  });

  it('toybox works with empty toybox', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['toybox']);
    expect(result.success).toBe(true);
  });

  it('need-repair works', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['need-repair']);
    expect(result.success).toBe(true);
  });
});
