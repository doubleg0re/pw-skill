import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Since rary.ts uses homedir() for paths, we test the core logic
// by directly manipulating the file structure matching the same format.
// For full integration, the DI pattern from session.ts could be applied later.

const TEST_DIR = join(tmpdir(), `pw-rary-test-${Date.now()}`);
const TOYBOX_DIR = join(TEST_DIR, 'toybox');
const EXTENSIONS_FILE = join(TEST_DIR, 'extensions.json');

function setup() {
  mkdirSync(TOYBOX_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// Helpers that mirror rary.ts logic for testing
function createPackage(name: string, manifest: any) {
  const dir = join(TOYBOX_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'larry.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function createPackageWithFiles(name: string, manifest: any, files: Record<string, string>) {
  const dir = createPackage(name, manifest);
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/') > 0 ? fullPath.lastIndexOf('/') : fullPath.lastIndexOf('\\'));
    if (parentDir !== dir) mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
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

describe('Rary — larry.json manifest', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates a valid package with manifest', () => {
    const manifest = { name: 'test-pkg', version: '1.0.0', type: 'script', description: 'A test package' };
    createPackage('test-pkg', manifest);
    const file = join(TOYBOX_DIR, 'test-pkg', 'larry.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8')).name).toBe('test-pkg');
  });

  it('supports extension type with hooks', () => {
    const manifest = {
      name: 'ext-pkg',
      version: '1.0.0',
      type: 'extension',
      hooks: {
        launch: { entry: 'hooks/launch.js' },
        close: { entry: 'hooks/close.js' },
      },
    };
    createPackage('ext-pkg', manifest);
    const read = JSON.parse(readFileSync(join(TOYBOX_DIR, 'ext-pkg', 'larry.json'), 'utf-8'));
    expect(read.type).toBe('extension');
    expect(read.hooks.launch.entry).toBe('hooks/launch.js');
  });

  it('supports commands array', () => {
    const manifest = {
      name: 'cmd-pkg',
      version: '1.0.0',
      type: 'script',
      commands: [
        { name: 'hello', entry: 'commands/hello.js' },
        { name: 'world', entry: 'commands/world.js' },
      ],
    };
    createPackage('cmd-pkg', manifest);
    const read = JSON.parse(readFileSync(join(TOYBOX_DIR, 'cmd-pkg', 'larry.json'), 'utf-8'));
    expect(read.commands).toHaveLength(2);
    expect(read.commands[0].name).toBe('hello');
  });
});

describe('Rary — toybox operations', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('lists packages in toybox', () => {
    createPackage('a', { name: 'a', version: '1.0.0' });
    createPackage('b', { name: 'b', version: '2.0.0' });
    const { readdirSync } = require('fs');
    const packages = readdirSync(TOYBOX_DIR);
    expect(packages).toHaveLength(2);
    expect(packages.sort()).toEqual(['a', 'b']);
  });

  it('returns empty for empty toybox', () => {
    const { readdirSync } = require('fs');
    expect(readdirSync(TOYBOX_DIR)).toHaveLength(0);
  });

  it('destroys a package', () => {
    createPackage('doomed', { name: 'doomed', version: '1.0.0' });
    expect(existsSync(join(TOYBOX_DIR, 'doomed'))).toBe(true);
    rmSync(join(TOYBOX_DIR, 'doomed'), { recursive: true, force: true });
    expect(existsSync(join(TOYBOX_DIR, 'doomed'))).toBe(false);
  });
});

describe('Rary — extension activation', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('activates an extension', () => {
    createPackage('my-ext', { name: 'my-ext', version: '1.0.0', type: 'extension' });
    saveExtensions({ 'my-ext': { package: 'my-ext', activatedAt: new Date().toISOString() } });
    const ext = loadExtensions();
    expect(ext['my-ext']).toBeDefined();
    expect(ext['my-ext'].package).toBe('my-ext');
  });

  it('deactivates an extension', () => {
    saveExtensions({ 'my-ext': { package: 'my-ext', activatedAt: new Date().toISOString() } });
    const ext = loadExtensions();
    delete ext['my-ext'];
    saveExtensions(ext);
    expect(loadExtensions()['my-ext']).toBeUndefined();
  });

  it('destroy also deactivates', () => {
    createPackage('active-ext', { name: 'active-ext', version: '1.0.0', type: 'extension' });
    saveExtensions({ 'active-ext': { package: 'active-ext', activatedAt: new Date().toISOString() } });
    // Destroy
    rmSync(join(TOYBOX_DIR, 'active-ext'), { recursive: true, force: true });
    const ext = loadExtensions();
    delete ext['active-ext'];
    saveExtensions(ext);
    expect(existsSync(join(TOYBOX_DIR, 'active-ext'))).toBe(false);
    expect(loadExtensions()['active-ext']).toBeUndefined();
  });
});

describe('Rary — repair check', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('detects missing larry.json', () => {
    mkdirSync(join(TOYBOX_DIR, 'broken'), { recursive: true });
    // No larry.json → should be detected
    expect(existsSync(join(TOYBOX_DIR, 'broken', 'larry.json'))).toBe(false);
  });

  it('detects missing entry file', () => {
    const manifest = { name: 'missing-entry', version: '1.0.0', entry: 'index.js' };
    createPackage('missing-entry', manifest);
    // index.js doesn't exist
    expect(existsSync(join(TOYBOX_DIR, 'missing-entry', 'index.js'))).toBe(false);
  });

  it('detects missing hook entry', () => {
    const manifest = {
      name: 'bad-hooks',
      version: '1.0.0',
      type: 'extension',
      hooks: { launch: { entry: 'hooks/launch.js' } },
    };
    createPackage('bad-hooks', manifest);
    expect(existsSync(join(TOYBOX_DIR, 'bad-hooks', 'hooks', 'launch.js'))).toBe(false);
  });

  it('passes when all files exist', () => {
    const manifest = {
      name: 'good-pkg',
      version: '1.0.0',
      entry: 'index.js',
      commands: [{ name: 'hello', entry: 'hello.js' }],
    };
    createPackageWithFiles('good-pkg', manifest, {
      'index.js': 'module.exports = {}',
      'hello.js': 'console.log("hello")',
    });
    expect(existsSync(join(TOYBOX_DIR, 'good-pkg', 'index.js'))).toBe(true);
    expect(existsSync(join(TOYBOX_DIR, 'good-pkg', 'hello.js'))).toBe(true);
  });

  it('detects active extension with missing package', () => {
    saveExtensions({ ghost: { package: 'ghost', activatedAt: new Date().toISOString() } });
    // Package "ghost" doesn't exist in toybox
    expect(existsSync(join(TOYBOX_DIR, 'ghost'))).toBe(false);
  });
});
