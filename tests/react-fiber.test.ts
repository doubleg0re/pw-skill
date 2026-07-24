import { describe, expect, it } from 'vitest';
import { buildFiberChain } from '../skills/pw-browse/scripts/react-fiber.js';

// Minimal fiber mock: link nodes via `.return` (target → root).
function fiber(partial: any, parent: any = null) {
  return { memoizedProps: {}, ...partial, return: parent };
}

describe('buildFiberChain', () => {
  it('returns [] for a null fiber', () => {
    expect(buildFiberChain(null)).toEqual([]);
  });

  it('names function components via displayName, falling back to name', () => {
    function SaveButton() {}
    const named = fiber({ type: { displayName: 'Toolbar' } });
    const byName = fiber({ type: SaveButton }, named); // real function .name fallback
    const chain = buildFiberChain(byName);
    expect(chain.map(n => n.name)).toEqual(['SaveButton', 'Toolbar']);
    expect(chain.every(n => n.kind === 'component')).toBe(true);
  });

  it('skips unnamed host elements without handlers, keeps hosts that own handlers', () => {
    const div = fiber({ type: 'div' }); // structural, no handlers → skipped
    const button = fiber({ type: 'button', memoizedProps: { onClick: () => {} } }, div);
    const chain = buildFiberChain(button);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ kind: 'host', name: 'button', handlers: ['onClick'] });
  });

  it('collects the on* handler names and the onClick source snippet', () => {
    const onClick = () => dispatch(save());
    const btn = fiber({ type: 'button', memoizedProps: { onClick, onMouseDown: () => {}, id: 'x' } });
    const [node] = buildFiberChain(btn);
    expect(node.handlers).toEqual(['onClick', 'onMouseDown']);
    expect(node.onClick).toContain('dispatch(save())');
  });

  it('formats _debugSource as file:line', () => {
    const cmp = fiber({
      type: { displayName: 'EditorPage' },
      _debugSource: { fileName: 'src/EditorPage.tsx', lineNumber: 42 },
    });
    expect(buildFiberChain(cmp)[0].source).toBe('src/EditorPage.tsx:42');
  });

  it('respects the depth limit', () => {
    let node = fiber({ type: { displayName: 'Root' } });
    for (let i = 0; i < 10; i++) {
      node = fiber({ type: { displayName: `C${i}` } }, node);
    }
    expect(buildFiberChain(node, { limit: 3 })).toHaveLength(3);
  });
});

// referenced only inside a stringified handler above; never executed
declare const dispatch: any;
declare const save: any;
