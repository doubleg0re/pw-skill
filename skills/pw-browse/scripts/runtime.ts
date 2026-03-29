// runtime.ts — Extension Runtime SDK
// Provides ExtensionRuntimeContext to hooks, custom actions, and event handlers.
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { join } from 'path';
import type { SessionInfo } from './session.js';
import { TAB_EVENTS, removeTab } from './tab-registry.js';

// --- Runtime Context ---

export interface ExtensionRuntimeContext {
  session: {
    id?: string;
    name: string;
    pid?: number;
    cdpEndpoint?: string;
    wsEndpoint?: string;
    userDataDir?: string;
  };
  browser?: any;
  context?: any;
  page?: any;
  getBrowser?: () => Promise<any | undefined>;
  getContext?: () => Promise<any | undefined>;
  getPage?: () => Promise<any | undefined>;
  tab?: {
    id?: number;
    url?: string;
    title?: string;
  };
  emitEvent: (event: string, payload: any) => void;
  registerCleanup: (fn: () => Promise<void> | void) => void;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

// --- Event dispatch ---

export interface EventHandler {
  event: string;
  packageName: string;
  fn: (payload: any) => Promise<void> | void;
}

// --- Runtime builder ---

export interface BuildRuntimeOptions {
  session: SessionInfo;
  browser?: any;
  context?: any;
  page?: any;
  eventHandlers?: EventHandler[];
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  source: string;
  timestamp: string;
}

const logBuffer: LogEntry[] = [];

function createLog(level: LogEntry['level'], msg: string, source: string = 'pw') {
  const entry: LogEntry = { level, message: msg, source, timestamp: new Date().toISOString() };
  logBuffer.push(entry);
  process.stderr.write(`[${source}:${level}] ${msg}\n`);
}

const defaultLogger = {
  info: (msg: string) => createLog('info', msg),
  warn: (msg: string) => createLog('warn', msg),
  error: (msg: string) => createLog('error', msg),
};

/** Get all structured log entries (for file save or AI analysis) */
export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

/** Clear log buffer */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

/**
 * Create a logger prefixed with extension package name.
 */
export function prefixedLogger(baseLogger: typeof defaultLogger, packageName: string) {
  return {
    info: (msg: string) => createLog('info', msg, packageName),
    warn: (msg: string) => createLog('warn', msg, packageName),
    error: (msg: string) => createLog('error', msg, packageName),
  };
}

/**
 * Create a per-extension view of the runtime context with prefixed logger.
 */
export function createExtensionView(runtime: ExtensionRuntimeContext, packageName: string): ExtensionRuntimeContext {
  return {
    ...runtime,
    logger: prefixedLogger(runtime.logger, packageName),
  };
}

export function buildRuntime(opts: BuildRuntimeOptions): ExtensionRuntimeContext & { _cleanups: (() => Promise<void> | void)[] } {
  const cleanups: (() => Promise<void> | void)[] = [];
  const handlers = opts.eventHandlers || [];
  const logger = defaultLogger;

  const emitEvent = (event: string, payload: any): void => {
    // Core tab registry GC: auto-remove tab on tab:closed
    if (event === TAB_EVENTS.CLOSED && payload?.tabId != null) {
      try { removeTab(payload.tabId); } catch {}
    }

    // Fire-and-forget: dispatch to matching handlers via Promise.allSettled
    const matching = handlers.filter(h => h.event === event);
    if (matching.length === 0) return;

    Promise.allSettled(
      matching.map(h => {
        try {
          return Promise.resolve(h.fn(payload));
        } catch (err) {
          return Promise.reject(err);
        }
      })
    ).then(results => {
      results.forEach((res, i) => {
        if (res.status === 'rejected') {
          const h = matching[i];
          logger.warn(`Event handler error (${h.packageName}:${event}): ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
        }
      });
    });
  };

  return {
    session: {
      id: opts.session.id,
      name: opts.session.name,
      pid: opts.session.pid,
      cdpEndpoint: opts.session.cdpEndpoint,
      wsEndpoint: opts.session.wsEndpoint,
    },
    browser: opts.browser,
    context: opts.context,
    page: opts.page,
    getBrowser: async () => opts.browser,
    getContext: async () => opts.context,
    getPage: async () => opts.page,
    tab: opts.page ? {
      url: typeof opts.page.url === 'function' ? opts.page.url() : undefined,
      title: undefined, // lazy — call getPage().title() if needed
    } : undefined,
    emitEvent,
    registerCleanup: (fn) => { cleanups.push(fn); },
    logger,
    _cleanups: cleanups,
  };
}

/**
 * Run all registered cleanups (called during close).
 */
export async function runCleanups(runtime: ExtensionRuntimeContext): Promise<{ ran: number; errors: string[] }> {
  const cleanups = (runtime as any)._cleanups as (() => Promise<void> | void)[] || [];
  const errors: string[] = [];
  let ran = 0;

  for (const fn of cleanups) {
    try {
      await fn();
      ran++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Clear after running
  cleanups.length = 0;
  return { ran, errors };
}

// --- Event handler loader ---

export async function loadEventHandlers(
  getActiveExtensions: () => { name: string; manifest: any }[],
  packageDir: (name: string) => string,
): Promise<{ handlers: EventHandler[]; errors: string[] }> {
  const handlers: EventHandler[] = [];
  const errors: string[] = [];

  for (const { name, manifest } of getActiveExtensions()) {
    if (!manifest?.events) continue;

    for (const [eventName, eventDef] of Object.entries(manifest.events as Record<string, { entry: string }>)) {
      const entryPath = join(packageDir(name), eventDef.entry);
      if (!existsSync(entryPath)) {
        errors.push(`${name}: event handler entry not found: ${entryPath}`);
        continue;
      }

      try {
        const url = pathToFileURL(entryPath).href;
        const mod = await import(url);
        const fn = mod.default || mod[eventName.replace(/:/g, '_')];
        if (typeof fn !== 'function') {
          errors.push(`${name}: event handler "${eventName}" must export default function`);
          continue;
        }
        handlers.push({ event: eventName, packageName: name, fn });
      } catch (err) {
        errors.push(`${name}: failed to load event handler "${eventName}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { handlers, errors };
}
