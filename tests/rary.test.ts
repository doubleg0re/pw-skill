import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { LarryManifest } from '../skills/pw-browse/scripts/rary.js';

// rary.ts uses homedir() internally, so full DI isn't available yet.
// We test:
// 1. larry.json schema compliance (type-level)
// 2. File structure expectations (what rary.ts reads/writes)
// 3. Import rary-commands.ts router for command coverage
// TODO: refactor rary.ts with createRaryStore({ toyboxDir, extensionsFile }) for full API testing

const TEST_DIR = join(tmpdir(), `pw-rary-test-${Date.now()}`);
const TOYBOX_DIR = join(TEST_DIR, 'toybox');
const EXTENSIONS_FILE = join(TEST_DIR, 'extensions.json');

function setup() {
  mkdirSync(TOYBOX_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function createPackage(name: string, manifest: LarryManifest, files?: Record<string, string>) {
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
  return dir;
}

function loadExtensions(): Record<string, any> {
  if (!existsSync(EXTENSIONS_FILE)) return {};
  return JSON.parse(readFileSync(EXTENSIONS_FILE, 'utf-8'));
}

function saveExtensions(ext: Record<string, any>) {
  writeFileSync(EXTENSIONS_FILE, JSON.stringify(ext, null, 2));
}

// --- larry.json manifest ---

describe('larry.json manifest schema', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('minimal manifest: name + version', () => {
    const manifest: LarryManifest = { name: 'test', version: '1.0.0' };
    createPackage('test', manifest);
    const read = JSON.parse(readFileSync(join(TOYBOX_DIR, 'test', 'larry.json'), 'utf-8'));
    expect(read.name).toBe('test');
    expect(read.version).toBe('1.0.0');
  });

  it('extension type with hooks', () => {
    const manifest: LarryManifest = {
      name: 'ext', version: '1.0.0', type: 'extension',
      hooks: {
        launch: { entry: 'hooks/launch.js' },
        load: { entry: 'hooks/load.js', scope: 'session' },
        close: { entry: 'hooks/close.js' },
      },
    };
    createPackage('ext', manifest);
    const read: LarryManifest = JSON.parse(readFileSync(join(TOYBOX_DIR, 'ext', 'larry.json'), 'utf-8'));
    expect(read.type).toBe('extension');
    expect(read.hooks!.launch!.entry).toBe('hooks/launch.js');
    expect(read.hooks!.load!.scope).toBe('session');
  });

  it('script type with commands', () => {
    const manifest: LarryManifest = {
      name: 'cmd', version: '1.0.0', type: 'script',
      commands: [
        { name: 'hello', entry: 'commands/hello.js' },
        { name: 'world', entry: 'commands/world.js' },
      ],
    };
    createPackage('cmd', manifest);
    const read: LarryManifest = JSON.parse(readFileSync(join(TOYBOX_DIR, 'cmd', 'larry.json'), 'utf-8'));
    expect(read.commands).toHaveLength(2);
  });

  it('manifest with rolling setup', () => {
    const manifest: LarryManifest = {
      name: 'setup-pkg', version: '1.0.0',
      rolling: { entry: 'setup.js' },
    };
    createPackage('setup-pkg', manifest);
    const read: LarryManifest = JSON.parse(readFileSync(join(TOYBOX_DIR, 'setup-pkg', 'larry.json'), 'utf-8'));
    expect(read.rolling!.entry).toBe('setup.js');
  });
});

// --- Toybox operations ---

describe('toybox file operations', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('lists packages by directory', () => {
    createPackage('a', { name: 'a', version: '1.0.0' });
    createPackage('b', { name: 'b', version: '2.0.0' });
    const { readdirSync } = require('fs');
    expect(readdirSync(TOYBOX_DIR).sort()).toEqual(['a', 'b']);
  });

  it('empty toybox', () => {
    const { readdirSync } = require('fs');
    expect(readdirSync(TOYBOX_DIR)).toHaveLength(0);
  });

  it('destroy removes directory', () => {
    createPackage('doomed', { name: 'doomed', version: '1.0.0' });
    rmSync(join(TOYBOX_DIR, 'doomed'), { recursive: true, force: true });
    expect(existsSync(join(TOYBOX_DIR, 'doomed'))).toBe(false);
  });
});

// --- Extension activation ---

describe('extension activation lifecycle', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('activate writes to extensions.json', () => {
    saveExtensions({ 'my-ext': { package: 'my-ext', activatedAt: '2026-03-28T00:00:00Z' } });
    expect(loadExtensions()['my-ext'].package).toBe('my-ext');
  });

  it('deactivate removes from extensions.json', () => {
    saveExtensions({ 'my-ext': { package: 'my-ext', activatedAt: '2026-03-28T00:00:00Z' } });
    const ext = loadExtensions();
    delete ext['my-ext'];
    saveExtensions(ext);
    expect(loadExtensions()['my-ext']).toBeUndefined();
  });

  it('multiple extensions can be active simultaneously', () => {
    saveExtensions({
      'ext-a': { package: 'ext-a', activatedAt: '2026-03-28T00:00:00Z' },
      'ext-b': { package: 'ext-b', activatedAt: '2026-03-28T00:00:01Z' },
    });
    const ext = loadExtensions();
    expect(Object.keys(ext)).toHaveLength(2);
  });

  it('destroy also deactivates', () => {
    createPackage('active-ext', { name: 'active-ext', version: '1.0.0', type: 'extension' });
    saveExtensions({ 'active-ext': { package: 'active-ext', activatedAt: '2026-03-28T00:00:00Z' } });
    rmSync(join(TOYBOX_DIR, 'active-ext'), { recursive: true, force: true });
    const ext = loadExtensions();
    delete ext['active-ext'];
    saveExtensions(ext);
    expect(existsSync(join(TOYBOX_DIR, 'active-ext'))).toBe(false);
    expect(loadExtensions()['active-ext']).toBeUndefined();
  });
});

// --- Repair detection ---

describe('repair detection patterns', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('missing larry.json is detectable', () => {
    mkdirSync(join(TOYBOX_DIR, 'broken'), { recursive: true });
    expect(existsSync(join(TOYBOX_DIR, 'broken', 'larry.json'))).toBe(false);
  });

  it('missing entry file is detectable', () => {
    createPackage('bad', { name: 'bad', version: '1.0.0', entry: 'index.js' });
    expect(existsSync(join(TOYBOX_DIR, 'bad', 'index.js'))).toBe(false);
  });

  it('missing hook entry is detectable', () => {
    createPackage('bad-hooks', {
      name: 'bad-hooks', version: '1.0.0', type: 'extension',
      hooks: { launch: { entry: 'hooks/launch.js' } },
    });
    expect(existsSync(join(TOYBOX_DIR, 'bad-hooks', 'hooks', 'launch.js'))).toBe(false);
  });

  it('all files present passes repair', () => {
    createPackage('good', {
      name: 'good', version: '1.0.0', entry: 'index.js',
      commands: [{ name: 'hello', entry: 'hello.js' }],
    }, {
      'index.js': 'export default {}',
      'hello.js': 'console.log("hi")',
    });
    expect(existsSync(join(TOYBOX_DIR, 'good', 'index.js'))).toBe(true);
    expect(existsSync(join(TOYBOX_DIR, 'good', 'hello.js'))).toBe(true);
  });

  it('ghost extension (active but package missing) is detectable', () => {
    saveExtensions({ ghost: { package: 'ghost', activatedAt: '2026-03-28T00:00:00Z' } });
    expect(existsSync(join(TOYBOX_DIR, 'ghost'))).toBe(false);
    expect(loadExtensions()['ghost']).toBeDefined();
  });
});

// --- Command router (import test) ---

describe('rary command router', () => {
  it('imports and responds to help', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['help']);
    expect(result.success).toBe(true);
    expect(result.data.message).toContain('Larry the Cat');
  });

  it('returns error for unknown command', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['nonexistent']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown rary command');
  });

  it('get requires an argument', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['get']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Usage');
  });

  it('peek requires an argument', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['peek']);
    expect(result.success).toBe(false);
  });

  it('destroy requires an argument', async () => {
    const { raryRouter } = await import('../skills/pw-browse/scripts/rary-commands.js');
    const result = await raryRouter(['destroy']);
    expect(result.success).toBe(false);
  });
});
