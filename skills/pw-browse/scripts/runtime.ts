// runtime.ts — Extension Runtime SDK
// Provides ExtensionRuntimeContext to hooks, custom actions, and event handlers.
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { join } from 'path';
import type { SessionInfo } from './session.js';

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

const defaultLogger = {
  info: (msg: string) => process.stderr.write(`[pw:info] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[pw:warn] ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[pw:error] ${msg}\n`),
};

export function buildRuntime(opts: BuildRuntimeOptions): ExtensionRuntimeContext {
  const cleanups: (() => Promise<void> | void)[] = [];
  const handlers = opts.eventHandlers || [];
  const logger = defaultLogger;

  const emitEvent = (event: string, payload: any): void => {
    // Fire-and-forget: dispatch to matching handlers
    for (const h of handlers) {
      if (h.event === event) {
        try {
          const result = h.fn(payload);
          // If async, catch errors silently
          if (result && typeof (result as any).catch === 'function') {
            (result as any).catch((err: any) => {
              logger.warn(`Event handler error (${h.packageName}:${event}): ${err instanceof Error ? err.message : String(err)}`);
            });
          }
        } catch (err) {
          logger.warn(`Event handler error (${h.packageName}:${event}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
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
  };
}

/**
 * Run all registered cleanups (called during close).
 */
export async function runCleanups(runtime: ExtensionRuntimeContext): Promise<void> {
  // Access cleanups via a known internal structure
  // For now, cleanups are fire-and-forget too
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
