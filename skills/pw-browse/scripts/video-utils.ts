// video-utils.ts — Shared video file management logic
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface VideoMeta {
  name: string;
  file: string | null;
}

/**
 * Auto-rename the recorded video based on saved metadata.
 * Uses the exact recorded file path when available, falls back to latest .webm.
 */
export function autoRenameVideo(stateDir: string): { renamed: boolean; from?: string; to?: string } {
  const metaFile = join(stateDir, 'video-meta.json');
  if (!existsSync(metaFile)) return { renamed: false };

  try {
    const meta: VideoMeta = JSON.parse(readFileSync(metaFile, 'utf-8'));
    const videoDir = join(stateDir, 'videos');
    const targetName = meta.name.endsWith('.webm') ? meta.name : `${meta.name}.webm`;
    const target = join(videoDir, targetName);

    let source: string | null = null;

    if (meta.file && existsSync(meta.file)) {
      source = meta.file;
    } else if (existsSync(videoDir)) {
      // Fallback: latest video file
      const videos = readdirSync(videoDir).filter(f => f.endsWith('.webm')).sort();
      if (videos.length > 0) {
        source = join(videoDir, videos[videos.length - 1]);
      }
    }

    if (source) {
      renameSync(source, target);
      unlinkSync(metaFile);
      return { renamed: true, from: source, to: target };
    }

    unlinkSync(metaFile);
    return { renamed: false };
  } catch {
    try { unlinkSync(metaFile); } catch {}
    return { renamed: false };
  }
}

/**
 * List video files with pending rename info.
 */
export function listVideoFiles(stateDir: string): {
  count: number;
  pendingName: string | null;
  videos: { file: string; size: number; created: string; renameOnClose?: string }[];
} {
  const videoDir = join(stateDir, 'videos');
  const metaFile = join(stateDir, 'video-meta.json');

  let pendingName: string | null = null;
  let pendingFile: string | null = null;
  if (existsSync(metaFile)) {
    try {
      const meta: VideoMeta = JSON.parse(readFileSync(metaFile, 'utf-8'));
      pendingName = meta.name;
      pendingFile = meta.file;
    } catch {}
  }

  if (!existsSync(videoDir)) return { count: 0, pendingName: null, videos: [] };

  const { statSync } = require('fs');
  const files = readdirSync(videoDir)
    .filter((f: string) => f.endsWith('.webm'))
    .map((f: string) => {
      const fullPath = join(videoDir, f);
      const stat = statSync(fullPath);
      return { file: fullPath, size: stat.size, created: stat.mtime.toISOString() };
    })
    .sort((a: any, b: any) => b.created.localeCompare(a.created));

  if (pendingName && files.length > 0) {
    const targetName = pendingName.endsWith('.webm') ? pendingName : `${pendingName}.webm`;
    const matchIdx = pendingFile
      ? files.findIndex((f: any) => f.file === pendingFile)
      : 0; // fallback to latest (index 0 since sorted desc)
    if (matchIdx >= 0) {
      (files[matchIdx] as any).renameOnClose = targetName;
    }
  }

  return { count: files.length, pendingName, videos: files };
}
