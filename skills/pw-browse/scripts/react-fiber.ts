// react-fiber.ts — Pure React fiber-tree walk, shared by the `pw react` command.
//
// This function is BOTH unit-tested in Node (with mock fibers) AND injected into
// the browser via `Function.prototype.toString()` (see react.ts). Keep it fully
// self-contained: reference only its parameters, inner functions, and JS builtins
// — no module imports, no outer-scope bindings — so the stringified source runs
// unchanged inside `page.evaluate`.

export interface FiberChainNode {
  kind: 'component' | 'host';
  name: string;
  handlers: string[];
  onClick?: string;
  source?: string;
}

export interface FiberChainOptions {
  limit?: number;
  fnLimit?: number;
}

// Walk a fiber's `.return` chain (target → root) and emit the nodes that carry
// meaning for "where does this event flow": named components and host elements
// that own event handlers. Structural/unnamed fibers are skipped as noise.
export function buildFiberChain(startFiber: any, options?: FiberChainOptions): FiberChainNode[] {
  const limit = options?.limit ?? 40;
  const fnLimit = options?.fnLimit ?? 160;

  const handlerNames = (props: any): string[] => {
    if (!props) return [];
    return Object.keys(props).filter(k => /^on[A-Z]/.test(k) && typeof props[k] === 'function');
  };

  const fiberSource = (fiber: any): string | undefined => {
    const dbg = fiber && fiber._debugSource;
    if (!dbg || !dbg.fileName) return undefined;
    return dbg.lineNumber != null ? `${dbg.fileName}:${dbg.lineNumber}` : dbg.fileName;
  };

  const chain: FiberChainNode[] = [];
  let fiber = startFiber;
  let steps = 0;

  while (fiber && steps < limit) {
    steps++;
    const type = fiber.type ?? fiber.elementType;
    const isHost = typeof type === 'string';
    const name = isHost
      ? type
      : (type && (type.displayName || type.name)) || null;

    const handlers = handlerNames(fiber.memoizedProps);

    if (name && (!isHost || handlers.length > 0)) {
      const node: FiberChainNode = {
        kind: isHost ? 'host' : 'component',
        name,
        handlers,
      };
      const onClick = fiber.memoizedProps && fiber.memoizedProps.onClick;
      if (typeof onClick === 'function') {
        node.onClick = onClick.toString().replace(/\s+/g, ' ').slice(0, fnLimit);
      }
      const source = fiberSource(fiber);
      if (source) node.source = source;
      chain.push(node);
    }

    fiber = fiber.return;
  }

  return chain;
}
