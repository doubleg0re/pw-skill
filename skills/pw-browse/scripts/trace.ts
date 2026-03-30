// trace.ts — Playwright trace recording (start/stop/view)
// Usage:
//   pw trace start                     # Start recording
//   pw trace start --screenshots       # Include screenshots per action
//   pw trace stop                      # Stop and save to .playwright-state/trace.zip
//   pw trace stop --name=login-flow    # Custom trace filename
//   pw trace view                      # Open trace viewer
//   pw trace view login-flow           # Open specific trace file
import { run, ensureStateDir, hasFlag, parseFlag, output } from './common.js';
import { join, resolve } from 'path';
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';

const STATE_DIR = resolve(process.cwd(), '.playwright-state');
const TRACE_DIR = join(STATE_DIR, 'traces');
const TRACE_STATE_FILE = join(STATE_DIR, 'trace-active.json');
const TRACE_STOP_FILE = join(STATE_DIR, 'trace-stop.json');
const TRACE_RESULT_FILE = join(STATE_DIR, 'trace-result.json');
const LEGACY_TRACE_STATE_FILE = join(STATE_DIR, 'trace-active.txt');

interface TraceActiveState {
  pid: number;
  session: string;
  startedAt: string;
  screenshots: boolean;
  snapshots: boolean;
}

interface TraceResultState {
  success: boolean;
  file?: string;
  error?: string;
  stoppedAt?: string;
}

function ensureTraceDir(): void {
  ensureStateDir();
  if (!existsSync(TRACE_DIR)) mkdirSync(TRACE_DIR, { recursive: true });
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function removeFile(file: string): void {
  try { unlinkSync(file); } catch {}
}

function cleanupTraceState(): void {
  removeFile(TRACE_STATE_FILE);
  removeFile(TRACE_STOP_FILE);
  removeFile(TRACE_RESULT_FILE);
  removeFile(LEGACY_TRACE_STATE_FILE);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForResult(timeoutMs: number, fn: () => TraceResultState | TraceActiveState | null): Promise<TraceResultState | TraceActiveState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

function getTracePath(target?: string): string | null {
  if (target) {
    return target.endsWith('.zip') ? target : join(TRACE_DIR, `${target}.zip`);
  }

  if (!existsSync(TRACE_DIR)) return null;
  const files = readdirSync(TRACE_DIR).filter(f => f.endsWith('.zip')).sort();
  if (files.length === 0) return null;
  return join(TRACE_DIR, files[files.length - 1]);
}

function traceStatusResult() {
  const active = readJson<TraceActiveState>(TRACE_STATE_FILE);
  const recording = !!(active && isPidAlive(active.pid));
  if (active && !recording) cleanupTraceState();
  const traces = existsSync(TRACE_DIR)
    ? readdirSync(TRACE_DIR).filter(f => f.endsWith('.zip'))
    : [];
  return {
    success: true,
    data: {
      recording,
      active: recording ? active : null,
      traces: traces.map(f => join(TRACE_DIR, f)),
    },
  };
}

function traceViewResult(target?: string) {
  const tracePath = getTracePath(target);
  if (!tracePath) return { success: false, error: 'No traces found' };
  if (!existsSync(tracePath)) return { success: false, error: `Trace not found: ${tracePath}` };

  const viewCommand = `npx playwright show-trace "${tracePath}"`;
  let opened = false;
  try {
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(npxBin, ['playwright', 'show-trace', tracePath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    opened = true;
  } catch {
    // show-trace may not be available or GUI launching may be blocked
  }

  return { success: true, data: { file: tracePath, command: viewCommand, opened } };
}

const rawArgs = process.argv.slice(2);
const initialCommand = rawArgs[0] || 'start';

if (initialCommand === 'view' || initialCommand === 'status') {
  ensureTraceDir();
  const result = initialCommand === 'view'
    ? traceViewResult(rawArgs[1])
    : traceStatusResult();
  output(result);
  process.exit(result.success ? 0 : 1);
}

run(async ({ args, session }) => {
  const command = args[0] || 'start';
  ensureTraceDir();

  switch (command) {
    case 'start': {
      if (!session?.name) return { success: false, error: 'Trace start requires an active session.' };

      const active = readJson<TraceActiveState>(TRACE_STATE_FILE);
      if (active && isPidAlive(active.pid)) {
        return {
          success: false,
          error: `Trace is already recording for session "${active.session}". Run \`pw trace stop\` first.`,
        };
      }

      cleanupTraceState();

      const screenshots = hasFlag(process.argv.slice(2), 'screenshots');
      const snapshots = hasFlag(process.argv.slice(2), 'snapshots');
      const sidecarScript = join(resolve(import.meta.dirname || __dirname), 'trace-sidecar.ts');

      const child = spawn(process.execPath, [
        ...process.execArgv,
        sidecarScript,
        `--session=${session.name}`,
        `--state-file=${TRACE_STATE_FILE}`,
        `--stop-file=${TRACE_STOP_FILE}`,
        `--result-file=${TRACE_RESULT_FILE}`,
        ...(screenshots ? ['--screenshots'] : []),
        ...(snapshots ? ['--snapshots'] : []),
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();

      const started = await waitForResult(5000, () => {
        const errorResult = readJson<TraceResultState>(TRACE_RESULT_FILE);
        if (errorResult?.error) return errorResult;
        const state = readJson<TraceActiveState>(TRACE_STATE_FILE);
        return state && isPidAlive(state.pid) ? state : null;
      });

      if (!started) {
        cleanupTraceState();
        return { success: false, error: 'Trace sidecar failed to start within 5s.' };
      }

      if ('error' in started && started.error) {
        cleanupTraceState();
        return { success: false, error: started.error };
      }

      return {
        success: true,
        data: {
          status: 'recording',
          screenshots,
          snapshots,
          session: session.name,
          sidecarPid: (started as TraceActiveState).pid,
        },
      };
    }

    case 'stop': {
      const active = readJson<TraceActiveState>(TRACE_STATE_FILE);
      if (!active || !isPidAlive(active.pid)) {
        cleanupTraceState();
        return { success: false, error: 'No active trace recording.' };
      }

      const name = parseFlag(process.argv.slice(2), 'name') || `trace-${Date.now()}`;
      const tracePath = join(TRACE_DIR, `${name}.zip`);
      removeFile(TRACE_RESULT_FILE);
      writeJson(TRACE_STOP_FILE, { path: tracePath });

      const stopped = await waitForResult(30000, () => readJson<TraceResultState>(TRACE_RESULT_FILE));
      if (!stopped) {
        return { success: false, error: 'Timed out waiting for trace sidecar to stop.' };
      }

      cleanupTraceState();

      if ('error' in stopped && stopped.error) {
        return { success: false, error: stopped.error };
      }

      return {
        success: true,
        data: {
          status: 'saved',
          file: tracePath,
          hint: `npx playwright show-trace "${tracePath}"`,
        },
      };
    }

    default:
      return { success: false, error: 'Usage: trace.ts [start|stop|view|status]' };
  }
});
