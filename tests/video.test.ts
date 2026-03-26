import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { autoRenameVideo, listVideoFiles } from '../skills/pw-browse/scripts/video-utils.js';

const TEST_DIR = join(tmpdir(), `pw-video-test-${Date.now()}`);
const VIDEO_DIR = join(TEST_DIR, 'videos');
const META_FILE = join(TEST_DIR, 'video-meta.json');

function setup() {
  mkdirSync(VIDEO_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeMeta(name: string, file: string | null = null) {
  writeFileSync(META_FILE, JSON.stringify({ name, file }));
}

describe('Video — auto rename on close', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('renames exact recorded file when path is known', () => {
    const videoPath = join(VIDEO_DIR, 'abc123.webm');
    writeFileSync(videoPath, 'fake-video');
    writeMeta('login-test', videoPath);

    const result = autoRenameVideo(TEST_DIR);

    expect(result.renamed).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'login-test.webm'))).toBe(true);
    expect(existsSync(videoPath)).toBe(false);
    expect(existsSync(META_FILE)).toBe(false);
  });

  it('falls back to latest when file path is null', () => {
    writeFileSync(join(VIDEO_DIR, 'aaa.webm'), 'old');
    writeFileSync(join(VIDEO_DIR, 'zzz.webm'), 'newest');
    writeMeta('my-recording', null);

    const result = autoRenameVideo(TEST_DIR);

    expect(result.renamed).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'my-recording.webm'))).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'aaa.webm'))).toBe(true); // old one untouched
    expect(existsSync(join(VIDEO_DIR, 'zzz.webm'))).toBe(false);
  });

  it('does nothing when no video-meta.json', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake-video');

    const result = autoRenameVideo(TEST_DIR);

    expect(result.renamed).toBe(false);
    expect(existsSync(join(VIDEO_DIR, 'abc123.webm'))).toBe(true);
  });

  it('handles .webm suffix in saved name', () => {
    const videoPath = join(VIDEO_DIR, 'abc123.webm');
    writeFileSync(videoPath, 'fake');
    writeMeta('demo.webm', videoPath);

    const result = autoRenameVideo(TEST_DIR);

    expect(result.renamed).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'demo.webm'))).toBe(true);
  });

  it('falls back to latest when recorded file no longer exists', () => {
    writeFileSync(join(VIDEO_DIR, 'new-file.webm'), 'data');
    writeMeta('result', join(VIDEO_DIR, 'deleted.webm')); // file doesn't exist

    const result = autoRenameVideo(TEST_DIR);

    expect(result.renamed).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'result.webm'))).toBe(true);
  });
});

describe('Video — list with pending name', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('shows pending rename on exact recorded file', () => {
    const videoPath = join(VIDEO_DIR, 'abc123.webm');
    writeFileSync(videoPath, 'fake');
    writeMeta('login-flow', videoPath);

    const result = listVideoFiles(TEST_DIR);

    expect(result.count).toBe(1);
    expect(result.pendingName).toBe('login-flow');
    expect(result.videos[0].renameOnClose).toBe('login-flow.webm');
  });

  it('shows null pending when no meta file', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake');

    const result = listVideoFiles(TEST_DIR);

    expect(result.count).toBe(1);
    expect(result.pendingName).toBeNull();
    expect(result.videos[0].renameOnClose).toBeUndefined();
  });

  it('returns empty when no videos', () => {
    const result = listVideoFiles(TEST_DIR);
    expect(result.count).toBe(0);
    expect(result.videos).toEqual([]);
  });
});
