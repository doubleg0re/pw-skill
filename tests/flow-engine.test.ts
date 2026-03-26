import { describe, it, expect, vi } from 'vitest';
import { VarStore, runSteps } from '../skills/pw-browse/scripts/sequence.js';

// Mock page object — only need methods that flow control actions use
function mockPage(overrides: Record<string, any> = {}): any {
  return {
    goto: vi.fn(),
    title: vi.fn().mockResolvedValue('Test Page'),
    screenshot: vi.fn(),
    evaluate: vi.fn(),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        click: vi.fn(),
        fill: vi.fn(),
        screenshot: vi.fn(),
        waitFor: vi.fn(),
        hover: vi.fn(),
        dblclick: vi.fn(),
        scrollIntoViewIfNeeded: vi.fn(),
        selectOption: vi.fn(),
        setInputFiles: vi.fn(),
        evaluate: vi.fn(),
        dragTo: vi.fn(),
      })),
    })),
    mouse: { click: vi.fn(), move: vi.fn(), down: vi.fn(), up: vi.fn(), dblclick: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
    getByText: vi.fn(() => ({
      first: vi.fn(() => ({ click: vi.fn() })),
    })),
    waitForTimeout: vi.fn(),
    waitForURL: vi.fn(),
    waitForFunction: vi.fn(),
    url: vi.fn().mockReturnValue('http://localhost:3000'),
    ...overrides,
  };
}

function emptyDefs() {
  return new Map<string, { params: string[]; body: any[] }>();
}

describe('Flow Engine — log', () => {
  it('logs a variable value via ref', async () => {
    const vars = new VarStore();
    vars.set('status', 200);
    const results: any[] = [];

    await runSteps(mockPage(), [{ action: 'log', ref: 'status' }], vars, results, emptyDefs());

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('log');
    expect(results[0].data).toBe(200);
  });

  it('logs interpolated text', async () => {
    const vars = new VarStore();
    vars.set('name', 'Alice');
    const results: any[] = [];

    await runSteps(mockPage(), [{ action: 'log', text: 'Hello {{name}}' }], vars, results, emptyDefs());

    expect(results[0].data).toBe('Hello Alice');
  });

  it('dumps all variables when no ref/text', async () => {
    const vars = new VarStore();
    vars.set('a', 1);
    vars.set('b', 2);
    const results: any[] = [];

    await runSteps(mockPage(), [{ action: 'log' }], vars, results, emptyDefs());

    expect(results[0].data).toEqual({ a: 1, b: 2 });
  });
});

describe('Flow Engine — condition', () => {
  it('takes then branch on eq match', async () => {
    const vars = new VarStore();
    vars.set('status', 200);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition',
      ref: 'status',
      eq: 200,
      then: [{ action: 'log', text: 'matched' }],
      else: [{ action: 'log', text: 'not matched' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
    expect(results[1].data).toBe('matched');
  });

  it('takes else branch on eq mismatch', async () => {
    const vars = new VarStore();
    vars.set('status', 404);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition',
      ref: 'status',
      eq: 200,
      then: [{ action: 'log', text: 'matched' }],
      else: [{ action: 'log', text: 'not matched' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(false);
    expect(results[1].data).toBe('not matched');
  });

  it('supports neq operator', async () => {
    const vars = new VarStore();
    vars.set('val', 'active');
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition', ref: 'val', neq: 'inactive',
      then: [{ action: 'log', text: 'yes' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
  });

  it('supports contains operator', async () => {
    const vars = new VarStore();
    vars.set('msg', 'hello world');
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition', ref: 'msg', contains: 'world',
      then: [{ action: 'log', text: 'found' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
  });

  it('supports exists operator', async () => {
    const vars = new VarStore();
    vars.set('data', { name: 'Alice' });
    const results: any[] = [];

    await runSteps(mockPage(), [
      { action: 'condition', ref: 'data.name', exists: true, then: [{ action: 'log', text: 'exists' }] },
      { action: 'condition', ref: 'data.missing', exists: true, then: [{ action: 'log', text: 'no' }], else: [{ action: 'log', text: 'correct' }] },
    ], vars, results, emptyDefs());

    expect(results[1].data).toBe('exists');
    expect(results[3].data).toBe('correct');
  });

  it('interpolates comparison values', async () => {
    const vars = new VarStore();
    vars.set('expected', 200);
    vars.set('actual', 200);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition', ref: 'actual', eq: '{{expected}}',
      then: [{ action: 'log', text: 'match' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
  });
});

describe('Flow Engine — each', () => {
  it('iterates over an array of objects', async () => {
    const vars = new VarStore();
    vars.set('items', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'each', ref: 'items', as: 'item', do: [
        { action: 'log', text: '{{$index}}:{{item.name}}' },
      ],
    }], vars, results, emptyDefs());

    // each header + 3 log entries
    expect(results[0].data).toEqual({ type: 'array', length: 3 });
    expect(results[1].data).toBe('0:a');
    expect(results[2].data).toBe('1:b');
    expect(results[3].data).toBe('2:c');
  });

  it('iterates over an object with {k,v} destructure', async () => {
    const vars = new VarStore();
    vars.set('obj', { x: 10, y: 20 });
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'each', ref: 'obj', as: '{k,v}', do: [
        { action: 'log', text: '{{k}}={{v}}' },
      ],
    }], vars, results, emptyDefs());

    expect(results[0].data).toEqual({ type: 'object', length: 2 });
    expect(results[1].data).toBe('x=10');
    expect(results[2].data).toBe('y=20');
  });

  it('sets $key to null for arrays', async () => {
    const vars = new VarStore();
    vars.set('arr', [1]);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'each', ref: 'arr', as: 'item', do: [
        { action: 'log', ref: '$key' },
      ],
    }], vars, results, emptyDefs());

    expect(results[1].data).toBeNull();
  });

  it('fails on null ref', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [{
      action: 'each', ref: 'missing', as: 'item', do: [],
    }], vars, results, emptyDefs());

    expect(outcome.success).toBe(false);
  });
});

describe('Flow Engine — loop', () => {
  it('repeats N times', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'loop', count: 3, do: [
        { action: 'log', text: 'i={{$index}}' },
      ],
    }], vars, results, emptyDefs());

    expect(results[0].data).toEqual({ count: 3 });
    expect(results[1].data).toBe('i=0');
    expect(results[2].data).toBe('i=1');
    expect(results[3].data).toBe('i=2');
  });
});

describe('Flow Engine — label/goto', () => {
  it('jumps to a label', async () => {
    const vars = new VarStore();
    vars.set('count', 0);
    const results: any[] = [];

    // Use goto to skip over a log step
    await runSteps(mockPage(), [
      { action: 'goto', label: 'end' },
      { action: 'log', text: 'skipped' },
      { label: 'end' },
      { action: 'log', text: 'reached' },
    ], vars, results, emptyDefs());

    const logResults = results.filter(r => r.action === 'log');
    expect(logResults).toHaveLength(1);
    expect(logResults[0].data).toBe('reached');
  });

  it('prevents infinite loops with max jumps', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { label: 'loop' },
      { action: 'goto', label: 'loop' },
    ], vars, results, emptyDefs());

    expect(outcome.success).toBe(false);
    // Should have hit the max jumps limit
    const failedGoto = results.find(r => !r.success && r.action === 'goto');
    expect(failedGoto).toBeDefined();
    expect(failedGoto!.error).toContain('Max jumps');
  });
});

describe('Flow Engine — def/call', () => {
  it('defines and calls a function with object args', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    await runSteps(mockPage(), [
      {
        action: 'def', name: 'greet', params: ['name'], do: [
          { action: 'log', text: 'Hello {{name}}' },
        ],
      },
      { action: 'call', name: 'greet', args: { name: 'Alice' } },
      { action: 'call', name: 'greet', args: { name: 'Bob' } },
    ], vars, results, defs);

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('Hello Alice');
    expect(logs[1].data).toBe('Hello Bob');
  });

  it('defines and calls a function with array args mapped to params', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    await runSteps(mockPage(), [
      {
        action: 'def', name: 'add', params: ['a', 'b'], do: [
          { action: 'log', text: '{{a}}+{{b}}' },
        ],
      },
      { action: 'call', name: 'add', args: ['10', '20'] },
    ], vars, results, defs);

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('10+20');
  });

  it('fails on calling undefined function', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'call', name: 'nonexistent' },
    ], vars, results, emptyDefs());

    expect(outcome.success).toBe(false);
    expect(results[0].error).toContain('not defined');
  });
});

describe('Flow Engine — out (variable capture)', () => {
  it('captures action result with out', async () => {
    const page = mockPage({
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('My Page'),
    });
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(page, [
      { action: 'navigate', args: ['http://localhost:3000'], out: 'nav' },
      { action: 'log', ref: 'nav.title' },
    ], vars, results, emptyDefs());

    expect(vars.get('nav.title')).toBe('My Page');
    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('My Page');
  });
});

describe('Flow Engine — combined', () => {
  it('each + condition + log work together', async () => {
    const vars = new VarStore();
    vars.set('users', [
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'user' },
      { name: 'Carol', role: 'admin' },
    ]);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'each', ref: 'users', as: 'u', do: [
        {
          action: 'condition', ref: 'u.role', eq: 'admin',
          then: [{ action: 'log', text: 'Admin: {{u.name}}' }],
        },
      ],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(2);
    expect(logs[0].data).toBe('Admin: Alice');
    expect(logs[1].data).toBe('Admin: Carol');
  });

  it('def + each + call work together', async () => {
    const vars = new VarStore();
    vars.set('people', [{ name: 'Alice' }, { name: 'Bob' }]);
    const results: any[] = [];
    const defs = emptyDefs();

    await runSteps(mockPage(), [
      {
        action: 'def', name: 'greet', params: ['who'], do: [
          { action: 'log', text: 'Hi {{who}}' },
        ],
      },
      {
        action: 'each', ref: 'people', as: 'person', do: [
          { action: 'call', name: 'greet', args: ['{{person.name}}'] },
        ],
      },
    ], vars, results, defs);

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(2);
    expect(logs[0].data).toBe('Hi Alice');
    expect(logs[1].data).toBe('Hi Bob');
  });
});
