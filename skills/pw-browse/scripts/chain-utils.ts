// chain-utils.ts — Shared helpers for :: chaining and inline $ret references

export function isChainReference(value: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(value);
}

function getPath(root: any, path: string): any {
  const parts = path.split('.');
  let current = root;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = current[part];
    }
  }
  return current;
}

export function normalizeChainReference(value: any): any {
  if (typeof value !== 'string') return value;
  if (!isChainReference(value)) return value;
  return `{{${value}}}`;
}

export function resolveInlineReference(value: any, scope: Record<string, any>): any {
  if (typeof value !== 'string') return value;
  if (!isChainReference(value)) return value;
  return getPath(scope, value);
}

export function buildChainStepArgs(args: string[]): any {
  const hasFlags = args.some(a => a.startsWith('--'));
  if (!hasFlags) return args.map(normalizeChainReference);

  const result: Record<string, any> = {};
  let idx = 0;
  for (const a of args) {
    if (a.startsWith('--')) {
      const eqIndex = a.indexOf('=');
      if (eqIndex > 0) {
        result[a.slice(2, eqIndex)] = normalizeChainReference(a.slice(eqIndex + 1));
      } else {
        result[a.slice(2)] = true;
      }
    } else {
      result[idx] = normalizeChainReference(a);
      idx++;
    }
  }
  return result;
}

export function buildInlineStepArgs(args: string[], scope: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  let positionalIndex = 0;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        result[arg.slice(2, eqIndex)] = resolveInlineReference(arg.slice(eqIndex + 1), scope);
      } else {
        result[arg.slice(2)] = true;
      }
    } else {
      result[positionalIndex] = resolveInlineReference(arg, scope);
      positionalIndex++;
    }
  }

  return result;
}
