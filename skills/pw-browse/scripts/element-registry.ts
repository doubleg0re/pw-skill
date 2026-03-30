// element-registry.ts — Ephemeral element key system for find→action handoff
// Keys are session-scoped, tab-scoped, document-scoped, short-lived.
// Lazy validation: keys become stale on session/tab/documentEpoch mismatch.
import { randomBytes } from 'crypto';
import { join } from 'path';
import type { Page } from 'playwright';
import { atomicWriteJSON, readJSONSafe } from './file-utils.js';

// --- Stable attribute names collected for fingerprinting ---

const STABLE_ATTR_NAMES = ['data-testid', 'data-test', 'name', 'aria-label', 'role'];

// --- Types ---

export interface ElementFingerprint {
  key: string;
  session: string;
  tabId: number;
  url: string;
  documentEpoch: number;
  createdAt: string;
  sourceSelector: string;
  sourceIndex: number;
  tag: string;
  id?: string;
  classTokens?: string[];
  stableAttrs: Record<string, string>;
  textSnippet?: string;
  textSnippetNormalized?: string;
}

export interface ValidationResult {
  valid: boolean;
  errorCode?: 'stale_key' | 'cross_session_key' | 'cross_tab_key';
  fingerprint?: ElementFingerprint;
}

export interface ResolveResult {
  success: boolean;
  locator?: string;
  errorCode?: 'stale_key' | 'cross_session_key' | 'cross_tab_key';
  error?: string;
  data?: Partial<ElementFingerprint> & { elementKey?: string };
}

export interface ElementRegistry {
  store(fp: ElementFingerprint): void;
  get(key: string): ElementFingerprint | undefined;
  validate(key: string, session: string, tabId: number, documentEpoch: number): ValidationResult;
  clear(): void;
}

// --- Key generation ---

export function generateElementKey(): string {
  return randomBytes(4).toString('hex');
}

// --- Stable attribute extraction ---

export function extractStableAttrs(attrs: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of STABLE_ATTR_NAMES) {
    if (attrs[name] !== undefined) {
      result[name] = attrs[name];
    }
  }
  return result;
}

// --- Fingerprint verification ---

export function verifyFingerprint(
  fp: ElementFingerprint,
  candidate: { tag: string; id?: string; classTokens?: string[]; stableAttrs: Record<string, string>; textSnippetNormalized?: string },
): boolean {
  // tag must match
  if (fp.tag !== candidate.tag) return false;

  // if id was present in fingerprint, it must still match
  if (fp.id && fp.id !== candidate.id) return false;

  // if stableAttrs present, each must match
  for (const [name, value] of Object.entries(fp.stableAttrs)) {
    if (candidate.stableAttrs[name] !== value) return false;
  }

  // if classTokens present, each stored token must still be present
  if (fp.classTokens && fp.classTokens.length > 0) {
    if (!candidate.classTokens) return false;
    for (const token of fp.classTokens) {
      if (!candidate.classTokens.includes(token)) return false;
    }
  }

  // if textSnippetNormalized present, candidate innerText must start with it
  if (fp.textSnippetNormalized) {
    if (!candidate.textSnippetNormalized || !candidate.textSnippetNormalized.startsWith(fp.textSnippetNormalized)) {
      return false;
    }
  }

  return true;
}

// --- CSS ID escaping (Node.js has no CSS.escape) ---

function escapeCssId(id: string): string {
  return id.replace(/([^\w-])/g, '\\$1');
}

function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- Fallback selector builder ---

export function buildFallbackSelector(fp: ElementFingerprint): string | null {
  // Priority: id > data-testid > data-test > name > aria-label > role
  if (fp.id) return `#${escapeCssId(fp.id)}`;
  if (fp.stableAttrs['data-testid']) return `[data-testid="${escapeCssAttrValue(fp.stableAttrs['data-testid'])}"]`;
  if (fp.stableAttrs['data-test']) return `[data-test="${escapeCssAttrValue(fp.stableAttrs['data-test'])}"]`;
  if (fp.stableAttrs['name']) return `${fp.tag}[name="${escapeCssAttrValue(fp.stableAttrs['name'])}"]`;
  if (fp.stableAttrs['aria-label']) return `[aria-label="${escapeCssAttrValue(fp.stableAttrs['aria-label'])}"]`;
  if (fp.stableAttrs['role']) return `${fp.tag}[role="${escapeCssAttrValue(fp.stableAttrs['role'])}"]`;
  return null;
}

// --- Registry factory ---

export function createElementRegistry(stateDir: string): ElementRegistry {
  const filePath = join(stateDir, 'element-registry.json');

  function loadAll(): Record<string, ElementFingerprint> {
    return readJSONSafe(filePath) || {};
  }

  function saveAll(data: Record<string, ElementFingerprint>): void {
    atomicWriteJSON(filePath, data);
  }

  return {
    store(fp: ElementFingerprint): void {
      const data = loadAll();
      data[fp.key] = fp;
      saveAll(data);
    },

    get(key: string): ElementFingerprint | undefined {
      const data = loadAll();
      return data[key];
    },

    validate(key: string, session: string, tabId: number, documentEpoch: number): ValidationResult {
      const data = loadAll();
      const fp = data[key];
      if (!fp) return { valid: false, errorCode: 'stale_key' };
      if (fp.session !== session) return { valid: false, errorCode: 'cross_session_key', fingerprint: fp };
      if (fp.tabId !== tabId) return { valid: false, errorCode: 'cross_tab_key', fingerprint: fp };
      if (fp.documentEpoch !== documentEpoch) return { valid: false, errorCode: 'stale_key', fingerprint: fp };
      return { valid: true, fingerprint: fp };
    },

    clear(): void {
      saveAll({});
    },
  };
}

// --- Full resolver (runs against live page) ---

export async function resolveElementKey(
  page: Page,
  key: string,
  session: string,
  tabId: number,
  documentEpoch: number,
  registry: ElementRegistry,
): Promise<ResolveResult> {
  // Step 1: Load and validate key record
  const validation = registry.validate(key, session, tabId, documentEpoch);
  if (!validation.valid) {
    const fp = validation.fingerprint;
    return {
      success: false,
      errorCode: validation.errorCode,
      error: `Element key "${key}" is invalid: ${validation.errorCode}`,
      data: {
        elementKey: key,
        ...(fp ? {
          session: fp.session,
          tabId: fp.tabId,
          documentEpoch: fp.documentEpoch,
          sourceSelector: fp.sourceSelector,
          sourceIndex: fp.sourceIndex,
          tag: fp.tag,
          id: fp.id,
          stableAttrs: fp.stableAttrs,
          textSnippetNormalized: fp.textSnippetNormalized,
        } : {}),
      },
    };
  }

  const fp = validation.fingerprint!;

  // Step 2: Re-run sourceSelector
  const stableAttrNames = STABLE_ATTR_NAMES;
  const candidates = await page.locator(fp.sourceSelector).evaluateAll(
    (els, { stableAttrNames: attrNames }) => els.map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classTokens: el.className ? el.className.split(/\s+/).filter(Boolean) : undefined,
      stableAttrs: (() => {
        const result: Record<string, string> = {};
        for (const name of attrNames) {
          const val = el.getAttribute(name);
          if (val !== null) result[name] = val;
        }
        return result;
      })(),
      textSnippetNormalized: (() => {
        const raw = (el as HTMLElement).innerText || el.textContent || '';
        return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80);
      })(),
    })),
    { stableAttrNames },
  );

  // Step 3: Read element at sourceIndex
  if (fp.sourceIndex < candidates.length) {
    const candidate = candidates[fp.sourceIndex];

    // Step 4: Verify fingerprint
    if (verifyFingerprint(fp, candidate)) {
      return {
        success: true,
        locator: `${fp.sourceSelector} >> nth=${fp.sourceIndex}`,
        data: { elementKey: key },
      };
    }
  }

  // Step 5: ONE fallback — build exact locator from stable identity fields
  const fallbackSelector = buildFallbackSelector(fp);
  if (fallbackSelector) {
    const fallbackCandidates = await page.locator(fallbackSelector).evaluateAll(
      (els, { stableAttrNames: attrNames }) => els.map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        classTokens: el.className ? el.className.split(/\s+/).filter(Boolean) : undefined,
        stableAttrs: (() => {
          const result: Record<string, string> = {};
          for (const name of attrNames) {
            const val = el.getAttribute(name);
            if (val !== null) result[name] = val;
          }
          return result;
        })(),
        textSnippetNormalized: (() => {
          const raw = (el as HTMLElement).innerText || el.textContent || '';
          return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80);
        })(),
      })),
      { stableAttrNames },
    );

    // Must be single candidate
    if (fallbackCandidates.length === 1 && verifyFingerprint(fp, fallbackCandidates[0])) {
      return {
        success: true,
        locator: fallbackSelector,
        data: { elementKey: key },
      };
    }
  }

  // Step 6: stale_key error
  return {
    success: false,
    errorCode: 'stale_key',
    error: `Element key "${key}" could not be resolved: element not found or fingerprint mismatch`,
    data: {
      elementKey: key,
      session: fp.session,
      tabId: fp.tabId,
      documentEpoch: fp.documentEpoch,
      sourceSelector: fp.sourceSelector,
      sourceIndex: fp.sourceIndex,
      tag: fp.tag,
      id: fp.id,
      stableAttrs: fp.stableAttrs,
      textSnippetNormalized: fp.textSnippetNormalized,
    },
  };
}
