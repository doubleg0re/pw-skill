// video.ts — List and manage recorded videos
// Usage:
//   pw video list                     # List saved videos
//   pw video path                     # Current recording path (if active)
//   pw video rename latest <name>     # Rename a video
//   pw video clear                    # Delete all saved videos
import { run } from './common.js';
import { join, resolve } from 'path';
import { existsSync, readdirSync, rmSync } from 'fs';
import { listVideoFiles } from './video-utils.js';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const VIDEO_DIR = join(STATE_DIR, 'videos');

run(async ({ page, args }) => {
  const command = args[0] || 'list';

  switch (command) {
    case 'list': {
      const result = listVideoFiles(STATE_DIR);
      return { success: true, data: result };
    }

    case 'path': {
      try {
        const videoPath = await page.video()?.path();
        if (videoPath) {
          return { success: true, data: { recording: true, file: videoPath } };
        }
        return { success: true, data: { recording: false } };
      } catch {
        return { success: true, data: { recording: false } };
      }
    }

    case 'rename': {
      const target = args[1]; // "latest" or filename
      const newName = args[2];
      if (!newName) return { success: false, error: 'Usage: video.ts rename <latest|filename> <new-name>' };
      if (!existsSync(VIDEO_DIR)) return { success: false, error: 'No videos found' };

      const { renameSync } = await import('fs');
      let oldPath: string;

      if (target === 'latest') {
        const files = readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm')).sort();
        if (files.length === 0) return { success: false, error: 'No videos found' };
        oldPath = join(VIDEO_DIR, files[files.length - 1]);
      } else {
        oldPath = target.endsWith('.webm') ? target : join(VIDEO_DIR, `${target}.webm`);
        if (!existsSync(oldPath)) return { success: false, error: `Video not found: ${oldPath}` };
      }

      const newPath = join(VIDEO_DIR, newName.endsWith('.webm') ? newName : `${newName}.webm`);
      renameSync(oldPath, newPath);
      return { success: true, data: { from: oldPath, to: newPath } };
    }

    case 'clear': {
      if (existsSync(VIDEO_DIR)) {
        rmSync(VIDEO_DIR, { recursive: true, force: true });
      }
      return { success: true, data: 'Videos cleared' };
    }

    default:
      return { success: false, error: 'Usage: video.ts [list|path|rename|clear]' };
  }
});
