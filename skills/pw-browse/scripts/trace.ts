// trace.ts — Playwright trace recording (start/stop/view)
// Usage:
//   pw trace start                     # Start recording
//   pw trace start --screenshots       # Include screenshots per action
//   pw trace stop                      # Stop and save to .playwright-state/trace.zip
//   pw trace stop --name=login-flow    # Custom trace filename
//   pw trace view                      # Open trace viewer
//   pw trace view login-flow           # Open specific trace file
import { run, ensureStateDir, hasFlag, parseFlag } from './common.js';
import { join, resolve } from 'path';
import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const TRACE_DIR = join(STATE_DIR, 'traces');
const TRACE_STATE_FILE = join(STATE_DIR, 'trace-active.txt');

run(async ({ page, context, args }) => {
  const command = args[0] || 'start';
  ensureStateDir();
  if (!existsSync(TRACE_DIR)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(TRACE_DIR, { recursive: true });
  }

  switch (command) {
    case 'start': {
      const screenshots = hasFlag(process.argv.slice(2), 'screenshots');
      const snapshots = hasFlag(process.argv.slice(2), 'snapshots');

      await context.tracing.start({
        screenshots: screenshots,
        snapshots: snapshots || true,
        sources: false,
      });

      // Mark trace as active
      const { writeFileSync } = await import('fs');
      writeFileSync(TRACE_STATE_FILE, Date.now().toString());

      return {
        success: true,
        data: {
          status: 'recording',
          screenshots,
          snapshots: snapshots || true,
        },
      };
    }

    case 'stop': {
      const name = parseFlag(process.argv.slice(2), 'name') || `trace-${Date.now()}`;
      const tracePath = join(TRACE_DIR, `${name}.zip`);

      await context.tracing.stop({ path: tracePath });

      // Clear active marker
      if (existsSync(TRACE_STATE_FILE)) {
        const { unlinkSync } = await import('fs');
        unlinkSync(TRACE_STATE_FILE);
      }

      return {
        success: true,
        data: {
          status: 'saved',
          file: tracePath,
          view: `npx playwright show-trace "${tracePath}"`,
        },
      };
    }

    case 'view': {
      const target = args[1];
      let tracePath: string;

      if (target) {
        // Specific file
        tracePath = target.endsWith('.zip') ? target : join(TRACE_DIR, `${target}.zip`);
      } else {
        // Latest trace
        if (!existsSync(TRACE_DIR)) return { success: false, error: 'No traces found' };
        const files = readdirSync(TRACE_DIR).filter(f => f.endsWith('.zip')).sort();
        if (files.length === 0) return { success: false, error: 'No traces found' };
        tracePath = join(TRACE_DIR, files[files.length - 1]);
      }

      if (!existsSync(tracePath)) return { success: false, error: `Trace not found: ${tracePath}` };

      try {
        execSync(`npx playwright show-trace "${tracePath}"`, { stdio: 'ignore' });
      } catch {
        // show-trace opens a browser window and may "fail" when closed
      }

      return { success: true, data: { file: tracePath } };
    }

    case 'status': {
      const active = existsSync(TRACE_STATE_FILE);
      const traces = existsSync(TRACE_DIR)
        ? readdirSync(TRACE_DIR).filter(f => f.endsWith('.zip'))
        : [];
      return {
        success: true,
        data: {
          recording: active,
          traces: traces.map(f => join(TRACE_DIR, f)),
        },
      };
    }

    default:
      return { success: false, error: 'Usage: trace.ts [start|stop|view|status]' };
  }
});
