// download.ts — Click a link/button and download the file
// Usage:
//   pw download "#download-btn"                     # Sync: wait for completion
//   pw download "test-file.txt" --async             # Async: return after download starts
//   pw download "#btn" --dir=./my-downloads         # Custom download directory
//   pw download status                              # List pending/completed downloads
//   pw download list                                # List saved files
import { run, parseFlag, hasFlag, ensureStateDir } from './common.js';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'fs';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const DOWNLOADS_DIR = join(STATE_DIR, 'downloads');
const PENDING_FILE = join(STATE_DIR, 'downloads-pending.json');

interface PendingDownload {
  id: string;
  filename: string;
  url: string;
  path: string;
  startedAt: string;
}

function loadPending(): PendingDownload[] {
  if (!existsSync(PENDING_FILE)) return [];
  try { return JSON.parse(readFileSync(PENDING_FILE, 'utf-8')); } catch { return []; }
}

function savePending(pending: PendingDownload[]): void {
  ensureStateDir();
  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

function addPending(dl: PendingDownload): void {
  const pending = loadPending();
  pending.push(dl);
  savePending(pending);
}

function removePending(id: string): void {
  savePending(loadPending().filter(d => d.id !== id));
}

run(async ({ page, args }) => {
  const command = args[0];

  // --- status: check pending downloads ---
  if (command === 'status') {
    const pending = loadPending();
    const resolved = pending.map(dl => ({
      ...dl,
      completed: existsSync(dl.path),
    }));
    // Clean up completed ones from pending
    const stillPending = resolved.filter(d => !d.completed);
    savePending(stillPending.map(({ completed, ...rest }) => rest));
    return { success: true, data: { downloads: resolved } };
  }

  // --- list: list downloaded files ---
  if (command === 'list') {
    if (!existsSync(DOWNLOADS_DIR)) return { success: true, data: { files: [] } };
    const files = readdirSync(DOWNLOADS_DIR).map(f => {
      const fullPath = join(DOWNLOADS_DIR, f);
      const stat = statSync(fullPath);
      return { file: fullPath, name: f, size: stat.size, created: stat.mtime.toISOString() };
    });
    return { success: true, data: { count: files.length, files } };
  }

  // --- download: click and save ---
  const target = command;
  if (!target) return { success: false, error: 'Usage: download.ts <selector|text> [--async] [--dir=path]' };

  const isAsync = hasFlag(process.argv.slice(2), 'async');
  const downloadDir = parseFlag(process.argv.slice(2), 'dir') || DOWNLOADS_DIR;

  if (!existsSync(downloadDir)) mkdirSync(downloadDir, { recursive: true });

  // Click and catch the download event
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

  // Click the target
  if (/^\d+,\d+$/.test(target)) {
    const [x, y] = target.split(',').map(Number);
    await page.mouse.click(x, y);
  } else if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[')) {
    await page.locator(target).first().click();
  } else {
    await page.getByText(target, { exact: false }).first().click();
  }

  const download = await downloadPromise;
  const suggestedName = download.suggestedFilename();
  const savePath = join(downloadDir, suggestedName);
  const dlId = `dl-${Date.now()}`;

  if (isAsync) {
    // Async: start saving in background, return immediately
    addPending({ id: dlId, filename: suggestedName, url: download.url(), path: savePath, startedAt: new Date().toISOString() });

    // Fire and forget — saveAs runs while we exit
    download.saveAs(savePath).then(() => {
      removePending(dlId);
    }).catch(() => {});

    return {
      success: true,
      data: {
        mode: 'async',
        id: dlId,
        filename: suggestedName,
        url: download.url(),
        path: savePath,
        hint: 'Download started. Check with `pw download status`.',
      },
    };
  }

  // Sync: wait for completion
  await download.saveAs(savePath);

  return {
    success: true,
    data: {
      mode: 'sync',
      filename: suggestedName,
      path: savePath,
      url: download.url(),
    },
  };
});
