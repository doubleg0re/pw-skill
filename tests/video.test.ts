import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test video file management logic in isolation
const TEST_DIR = join(tmpdir(), `pw-video-test-${Date.now()}`);
const VIDEO_DIR = join(TEST_DIR, 'videos');
const VIDEO_NAME_FILE = join(TEST_DIR, 'video-name.txt');

function setup() {
  mkdirSync(VIDEO_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// Simulate the rename logic from pw.ts close
function autoRenameVideo(stateDir: string) {
  const videoNameFile = join(stateDir, 'video-name.txt');
  const videoDir = join(stateDir, 'videos');
  if (existsSync(videoNameFile)) {
    const videoName = readFileSync(videoNameFile, 'utf-8').trim();
    if (existsSync(videoDir)) {
      const { renameSync, unlinkSync } = require('fs');
      const videos = readdirSync(videoDir).filter((f: string) => f.endsWith('.webm')).sort();
      if (videos.length > 0) {
        const latest = join(videoDir, videos[videos.length - 1]);
        const target = join(videoDir, videoName.endsWith('.webm') ? videoName : `${videoName}.webm`);
        renameSync(latest, target);
      }
      unlinkSync(videoNameFile);
    }
  }
}

// Simulate video list logic from video.ts
function listVideos(stateDir: string) {
  const videoDir = join(stateDir, 'videos');
  const videoNameFile = join(stateDir, 'video-name.txt');
  const pendingName = existsSync(videoNameFile)
    ? readFileSync(videoNameFile, 'utf-8').trim()
    : null;

  if (!existsSync(videoDir)) return { count: 0, pendingName: null, videos: [] };

  const files = readdirSync(videoDir)
    .filter(f => f.endsWith('.webm'))
    .sort()
    .map(f => ({ file: join(videoDir, f) }));

  if (pendingName && files.length > 0) {
    const targetName = pendingName.endsWith('.webm') ? pendingName : `${pendingName}.webm`;
    (files[files.length - 1] as any).renameOnClose = targetName;
  }

  return { count: files.length, pendingName, videos: files };
}

describe('Video — auto rename on close', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('renames latest video to saved name', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake-video');
    writeFileSync(VIDEO_NAME_FILE, 'login-test');

    autoRenameVideo(TEST_DIR);

    expect(existsSync(join(VIDEO_DIR, 'login-test.webm'))).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'abc123.webm'))).toBe(false);
    expect(existsSync(VIDEO_NAME_FILE)).toBe(false);
  });

  it('renames latest when multiple videos exist', () => {
    writeFileSync(join(VIDEO_DIR, 'aaa.webm'), 'old');
    writeFileSync(join(VIDEO_DIR, 'zzz.webm'), 'newest');
    writeFileSync(VIDEO_NAME_FILE, 'my-recording');

    autoRenameVideo(TEST_DIR);

    expect(existsSync(join(VIDEO_DIR, 'my-recording.webm'))).toBe(true);
    expect(existsSync(join(VIDEO_DIR, 'aaa.webm'))).toBe(true); // old one untouched
    expect(existsSync(join(VIDEO_DIR, 'zzz.webm'))).toBe(false);
  });

  it('does nothing when no video-name.txt', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake-video');

    autoRenameVideo(TEST_DIR);

    expect(existsSync(join(VIDEO_DIR, 'abc123.webm'))).toBe(true);
  });

  it('handles .webm suffix in saved name', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake');
    writeFileSync(VIDEO_NAME_FILE, 'demo.webm');

    autoRenameVideo(TEST_DIR);

    expect(existsSync(join(VIDEO_DIR, 'demo.webm'))).toBe(true);
  });
});

describe('Video — list with pending name', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('shows pending rename on latest video', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake');
    writeFileSync(VIDEO_NAME_FILE, 'login-flow');

    const result = listVideos(TEST_DIR);

    expect(result.count).toBe(1);
    expect(result.pendingName).toBe('login-flow');
    expect((result.videos[0] as any).renameOnClose).toBe('login-flow.webm');
  });

  it('shows null pending when no video-name.txt', () => {
    writeFileSync(join(VIDEO_DIR, 'abc123.webm'), 'fake');

    const result = listVideos(TEST_DIR);

    expect(result.count).toBe(1);
    expect(result.pendingName).toBeNull();
    expect((result.videos[0] as any).renameOnClose).toBeUndefined();
  });

  it('returns empty when no videos', () => {
    const result = listVideos(TEST_DIR);
    expect(result.count).toBe(0);
    expect(result.videos).toEqual([]);
  });
});
