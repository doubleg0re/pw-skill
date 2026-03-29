import { describe, it, expect, vi } from 'vitest';
import { VarStore, runSteps, evaluateCondition, validateSteps } from '../skills/pw-browse/scripts/sequence.js';

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
  return new Map<string, any>();
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
      action: 'each', ref: 'items', as: 'item', items: [
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
      action: 'each', ref: 'obj', as: '{k,v}', items: [
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
      action: 'each', ref: 'arr', as: 'item', items: [
        { action: 'log', ref: '$key' },
      ],
    }], vars, results, emptyDefs());

    expect(results[1].data).toBeNull();
  });

  it('fails on null ref', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [{
      action: 'each', ref: 'missing', as: 'item', items: [],
    }], vars, results, emptyDefs());

    expect(outcome.success).toBe(false);
  });
});

describe('Flow Engine — loop', () => {
  it('repeats N times (count backward compat)', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'loop', count: 3, items: [
        { action: 'log', text: 'i={{$index}}' },
      ],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(3);
    expect(logs[0].data).toBe('i=0');
    expect(logs[1].data).toBe('i=1');
    expect(logs[2].data).toBe('i=2');
  });

  it('condition-based loop', async () => {
    const vars = new VarStore();
    vars.set('found', false);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'loop',
      condition: { and: [{ ref: '$index', lt: 5 }, { ref: 'found', neq: true }] },
      items: [
        { action: 'log', text: 'iter={{$index}}' },
        // Simulate finding at iteration 2
        { action: 'condition', ref: '$index', eq: 2,
          then: [{ action: 'log', text: 'found it' }] },
      ],
    } as any], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    // Should run 5 times since we never set found=true in this test
    expect(logs.filter(l => typeof l.data === 'string' && l.data.startsWith('iter=')).length).toBe(5);
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
        action: 'def', name: 'greet', params: ['name'], items: [
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
        action: 'def', name: 'add', params: ['a', 'b'], items: [
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
      action: 'each', ref: 'users', as: 'u', items: [
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
        action: 'def', name: 'greet', params: ['who'], items: [
          { action: 'log', text: 'Hi {{who}}' },
        ],
      },
      {
        action: 'each', ref: 'people', as: 'person', items: [
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

// --- Task 1: evaluateCondition ---

describe('evaluateCondition', () => {
  it('evaluates leaf eq', () => {
    const vars = new VarStore();
    vars.set('x', 10);
    expect(evaluateCondition({ ref: 'x', eq: 10 }, vars)).toBe(true);
    expect(evaluateCondition({ ref: 'x', eq: 99 }, vars)).toBe(false);
  });

  it('evaluates leaf contains', () => {
    const vars = new VarStore();
    vars.set('msg', 'hello world');
    expect(evaluateCondition({ ref: 'msg', contains: 'world' }, vars)).toBe(true);
    expect(evaluateCondition({ ref: 'msg', contains: 'xyz' }, vars)).toBe(false);
  });

  it('evaluates leaf exists', () => {
    const vars = new VarStore();
    vars.set('a', 'yes');
    expect(evaluateCondition({ ref: 'a', exists: true }, vars)).toBe(true);
    expect(evaluateCondition({ ref: 'missing', exists: true }, vars)).toBe(false);
    expect(evaluateCondition({ ref: 'missing', exists: false }, vars)).toBe(true);
  });

  it('evaluates and', () => {
    const vars = new VarStore();
    vars.set('x', 10);
    vars.set('y', 20);
    expect(evaluateCondition({ and: [{ ref: 'x', eq: 10 }, { ref: 'y', eq: 20 }] }, vars)).toBe(true);
    expect(evaluateCondition({ and: [{ ref: 'x', eq: 10 }, { ref: 'y', eq: 99 }] }, vars)).toBe(false);
  });

  it('evaluates or', () => {
    const vars = new VarStore();
    vars.set('x', 10);
    expect(evaluateCondition({ or: [{ ref: 'x', eq: 99 }, { ref: 'x', eq: 10 }] }, vars)).toBe(true);
    expect(evaluateCondition({ or: [{ ref: 'x', eq: 99 }, { ref: 'x', eq: 88 }] }, vars)).toBe(false);
  });

  it('evaluates nested and/or', () => {
    const vars = new VarStore();
    vars.set('role', 'admin');
    vars.set('active', true);
    // admin AND (active=true OR role=superadmin)
    expect(evaluateCondition({
      and: [
        { ref: 'role', eq: 'admin' },
        { or: [{ ref: 'active', eq: true }, { ref: 'role', eq: 'superadmin' }] },
      ],
    }, vars)).toBe(true);
  });

  it('evaluates all leaf operators', () => {
    const vars = new VarStore();
    vars.set('n', 5);
    expect(evaluateCondition({ ref: 'n', gt: 3 }, vars)).toBe(true);
    expect(evaluateCondition({ ref: 'n', lt: 10 }, vars)).toBe(true);
    expect(evaluateCondition({ ref: 'n', neq: 99 }, vars)).toBe(true);
  });
});

describe('Flow Engine — composite condition steps', () => {
  it('and condition in step', async () => {
    const vars = new VarStore();
    vars.set('x', 1);
    vars.set('y', 2);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition',
      and: [{ ref: 'x', eq: 1 }, { ref: 'y', eq: 2 }],
      then: [{ action: 'log', text: 'both' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
    expect(results[1].data).toBe('both');
  });

  it('or condition in step', async () => {
    const vars = new VarStore();
    vars.set('x', 99);
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'condition',
      or: [{ ref: 'x', eq: 1 }, { ref: 'x', eq: 99 }],
      then: [{ action: 'log', text: 'found' }],
      else: [{ action: 'log', text: 'nope' }],
    }], vars, results, emptyDefs());

    expect(results[0].data.matched).toBe(true);
    expect(results[1].data).toBe('found');
  });
});

// --- Task 2: validateSteps ---

describe('validateSteps', () => {
  it('passes valid steps', () => {
    expect(validateSteps([
      { action: 'navigate', args: ['http://localhost'] },
      { action: 'click', args: ['#btn'] },
      { label: 'end' },
    ])).toEqual([]);
  });

  it('detects unknown action', () => {
    const errors = validateSteps([{ action: 'banana' }]);
    expect(errors[0]).toContain('unknown action');
  });

  it('detects condition mixing ref with and/or', () => {
    const errors = validateSteps([{ action: 'condition', ref: 'x', and: [{ ref: 'y', eq: 1 }] } as any]);
    expect(errors[0]).toContain('cannot mix');
  });

  it('detects condition with both and + or', () => {
    const errors = validateSteps([{ action: 'condition', and: [], or: [] } as any]);
    expect(errors[0]).toContain('both "and" and "or"');
  });

  it('detects def without name', () => {
    const errors = validateSteps([{ action: 'def', items: [] }]);
    expect(errors[0]).toContain('requires "name"');
  });

  it('detects call without name', () => {
    const errors = validateSteps([{ action: 'call' }]);
    expect(errors[0]).toContain('requires "name"');
  });

  it('detects each without ref', () => {
    const errors = validateSteps([{ action: 'each', items: [] }]);
    expect(errors[0]).toContain('requires "ref"');
  });

  it('detects loop without condition or count', () => {
    const errors = validateSteps([{ action: 'loop', items: [] } as any]);
    expect(errors[0]).toContain('requires "condition"');
  });

  it('detects try without items', () => {
    const errors = validateSteps([{ action: 'try' }]);
    expect(errors[0]).toContain('requires "items"');
  });

  it('detects goto without label', () => {
    const errors = validateSteps([{ action: 'goto' }]);
    expect(errors[0]).toContain('requires "label"');
  });

  it('validates nested steps', () => {
    const errors = validateSteps([{
      action: 'condition', ref: 'x', eq: 1,
      then: [{ action: 'banana' }],
    }]);
    expect(errors[0]).toContain('unknown action');
    expect(errors[0]).toContain('then');
  });

  it('step with no action, label, or comment is an error', () => {
    const errors = validateSteps([{} as any]);
    expect(errors[0]).toContain('no action');
  });
});

// --- Task 3: def type + items ---

describe('Flow Engine — def with type + items', () => {
  it('def type=condition is used by try catch:<name>', async () => {
    const vars = new VarStore();
    vars.set('url', 'http://localhost/login');
    const results: any[] = [];
    const defs = emptyDefs();
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('fail')) })) })),
    });

    await runSteps(page, [
      {
        action: 'def', type: 'condition', name: 'isLogin',
        items: [{ ref: 'url', contains: '/login' }, { ref: 'url', contains: '/signin' }],
      } as any,
      {
        action: 'try',
        items: [{ action: 'click', args: ['#x'] }],
        'catch:isLogin': [{ action: 'log', text: 'redirected to login' }],
        catch: [{ action: 'log', text: 'generic' }],
      } as any,
    ], vars, results, defs);

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('redirected to login');
  });

  it('def type=func with items works like do', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    await runSteps(mockPage(), [
      {
        action: 'def', type: 'func', name: 'greet', params: ['who'],
        items: [{ action: 'log', text: 'Hi {{who}}' }],
      } as any,
      { action: 'call', name: 'greet', args: ['Alice'] },
    ], vars, results, defs);

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('Hi Alice');
  });

  it('call on condition def returns error', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    const outcome = await runSteps(mockPage(), [
      { action: 'def', type: 'condition', name: 'check', items: [{ ref: 'x', eq: 1 }] } as any,
      { action: 'call', name: 'check' },
    ], vars, results, defs);

    expect(outcome.success).toBe(false);
    expect(results.find(r => !r.success)?.error).toContain('condition def');
  });
});

// --- Task 4: try / catch / finally ---

describe('Flow Engine — try/catch/finally', () => {
  it('catch runs on error', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('Element not found')) })) })),
    });

    await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#missing'] }],
      catch: [{ action: 'log', text: 'caught: {{$error}}' }],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toContain('Element not found');
  });

  it('finally always runs on success', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(mockPage(), [{
      action: 'try',
      items: [{ action: 'log', text: 'ok' }],
      finally: [{ action: 'log', text: 'cleanup' }],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(2);
    expect(logs[0].data).toBe('ok');
    expect(logs[1].data).toBe('cleanup');
  });

  it('finally always runs on error', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('fail')) })) })),
    });

    await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#x'] }],
      catch: [{ action: 'log', text: 'caught' }],
      finally: [{ action: 'log', text: 'cleanup' }],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs.map(l => l.data)).toContain('caught');
    expect(logs.map(l => l.data)).toContain('cleanup');
  });

  it('typed catch:notfound matches', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('Element not found')) })) })),
    });

    await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#x'] }],
      'catch:notfound': [{ action: 'log', text: 'not found handler' }],
      catch: [{ action: 'log', text: 'generic' }],
    } as any], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('not found handler');
  });

  it('sets $error and $errorType variables', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('Timeout 30000ms exceeded')) })) })),
    });

    await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#x'] }],
      catch: [{ action: 'log', text: '{{$errorType}}' }],
    }], vars, results, emptyDefs());

    expect(vars.get('$errorType')).toBe('timeout');
    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('timeout');
  });

  it('no catch = fail after finally', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('boom')) })) })),
    });

    const outcome = await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#x'] }],
      finally: [{ action: 'log', text: 'cleanup' }],
    }], vars, results, emptyDefs());

    expect(outcome.success).toBe(false);
    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toBe('cleanup');
  });
});

describe('validateSteps — out with $ prefix', () => {
  it('rejects out starting with $', () => {
    const errors = validateSteps([{ action: 'fetch', args: ['GET', '/api'], out: '$result' }]);
    expect(errors[0]).toContain('cannot start with "$"');
  });

  it('accepts normal out name', () => {
    const errors = validateSteps([{ action: 'fetch', args: ['GET', '/api'], out: 'result' }]);
    expect(errors.filter(e => e.includes('out'))).toHaveLength(0);
  });
});

// --- Shell action ---

describe('Flow Engine — shell', () => {
  it('rejects shell without allowShell', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'shell', args: ['echo', 'hello'] },
    ], vars, results, emptyDefs(), 0, { allowShell: false });

    expect(outcome.success).toBe(false);
    expect(results[0].error).toContain('--allow-shell');
  });

  it('runs shell with allowShell', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'shell', args: ['node', '-e', 'console.log("hello")'], out: 'res' },
    ], vars, results, emptyDefs(), 0, { allowShell: true });

    expect(outcome.success).toBe(true);
    expect(vars.get('res').exitCode).toBe(0);
    expect(vars.get('res').stdout).toContain('hello');
  });

  it('shell failure stops sequence', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'shell', args: ['node', '-e', 'process.exit(42)'], out: 'res' },
      { action: 'log', text: 'should not reach' },
    ], vars, results, emptyDefs(), 0, { allowShell: true });

    expect(outcome.success).toBe(false);
    expect(vars.get('res').exitCode).toBe(42);
  });
});

describe('validateSteps — wait actions', () => {
  it('rejects empty actions array', () => {
    const errors = validateSteps([{ action: 'wait', args: ['user-action'], actions: [] } as any]);
    expect(errors[0]).toContain('non-empty');
  });

  it('accepts valid actions', () => {
    const errors = validateSteps([{ action: 'wait', args: ['user-action'], actions: ['approve', 'cancel'] } as any]);
    expect(errors.filter(e => e.includes('actions'))).toHaveLength(0);
  });
});

describe('validateSteps — shell', () => {
  it('rejects shell without args', () => {
    const errors = validateSteps([{ action: 'shell' }]);
    expect(errors[0]).toContain('requires "args"');
  });
});

// --- set action ---

describe('Flow Engine — set', () => {
  it('copies variable with ref', async () => {
    const vars = new VarStore();
    vars.set('original', 'hello');
    const results: any[] = [];

    await runSteps(mockPage(), [
      { action: 'set', items: { copy: { ref: 'original' } } } as any,
    ], vars, results, emptyDefs());

    expect(vars.get('copy')).toBe('hello');
  });

  it('assigns literal with value', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(mockPage(), [
      { action: 'set', items: { count: { value: 42 }, data: { value: { ok: true } } } } as any,
    ], vars, results, emptyDefs());

    expect(vars.get('count')).toBe(42);
    expect(vars.get('data')).toEqual({ ok: true });
  });

  it('multiple set in one step', async () => {
    const vars = new VarStore();
    vars.set('a', 1);
    vars.set('b', 2);
    const results: any[] = [];

    await runSteps(mockPage(), [
      { action: 'set', items: { x: { ref: 'a' }, y: { ref: 'b' }, z: { value: 'literal' } } } as any,
    ], vars, results, emptyDefs());

    expect(vars.get('x')).toBe(1);
    expect(vars.get('y')).toBe(2);
    expect(vars.get('z')).toBe('literal');
  });
});

describe('validateSteps — set', () => {
  it('rejects $ destination', () => {
    const errors = validateSteps([{ action: 'set', items: { '$bad': { value: 1 } } } as any]);
    expect(errors[0]).toContain('cannot start with "$"');
  });

  it('rejects both ref and value', () => {
    const errors = validateSteps([{ action: 'set', items: { x: { ref: 'a', value: 1 } } } as any]);
    expect(errors[0]).toContain('exactly one');
  });

  it('rejects neither ref nor value', () => {
    const errors = validateSteps([{ action: 'set', items: { x: {} } } as any]);
    expect(errors[0]).toContain('ref');
  });
});

// --- Ephemeral registers ---

describe('Flow Engine — ephemeral registers', () => {
  it('sets $ret after successful action', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Test'),
    });

    await runSteps(page, [
      { action: 'navigate', args: ['http://localhost'] },
      { action: 'log', ref: '$ret' },
    ], vars, results, emptyDefs());

    // $ret should have the navigate result
    const ret = vars.get('$ret');
    expect(ret).toBeDefined();
  });

  it('sets $err after failed action in try', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const page = mockPage({
      locator: vi.fn(() => ({ first: vi.fn(() => ({ click: vi.fn().mockRejectedValue(new Error('boom')) })) })),
    });

    await runSteps(page, [{
      action: 'try',
      items: [{ action: 'click', args: ['#x'] }],
      catch: [{ action: 'log', text: 'err={{$err}}' }],
    }], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs[0].data).toContain('boom');
  });
});

// --- Wrapper format ---

describe('Flow Engine — wrapper format', () => {
  it('comment-only step is skipped', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    await runSteps(mockPage(), [
      { comment: 'this is a note' } as any,
      { action: 'log', text: 'after comment' },
    ], vars, results, emptyDefs());

    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toBe('after comment');
  });
});

describe('validateSteps — wrapper', () => {
  it('comment-only step is valid', () => {
    const errors = validateSteps([{ comment: 'note' } as any]);
    expect(errors).toHaveLength(0);
  });

  it('comment + action is invalid', () => {
    const errors = validateSteps([{ comment: 'note', action: 'click', args: ['#x'] } as any]);
    expect(errors[0]).toContain('both "comment" and "action"');
  });

  it('empty step is invalid', () => {
    const errors = validateSteps([{} as any]);
    expect(errors[0]).toContain('no action');
  });
});

// --- Subflow ---

describe('Flow Engine — return action', () => {
  it('return exits with value', async () => {
    const vars = new VarStore();
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'log', text: 'before' },
      { action: 'return', value: { value: 42 } } as any,
      { action: 'log', text: 'after' },
    ], vars, results, emptyDefs());

    expect(outcome.success).toBe(true);
    expect(outcome.returnValue).toBe(42);
    // 'after' should not run
    const logs = results.filter(r => r.action === 'log');
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toBe('before');
  });

  it('return with $ref resolves variable', async () => {
    const vars = new VarStore();
    vars.set('myResult', { ok: true });
    const results: any[] = [];

    const outcome = await runSteps(mockPage(), [
      { action: 'return', value: { $ref: 'myResult' } } as any,
    ], vars, results, emptyDefs());

    expect(outcome.returnValue).toEqual({ ok: true });
  });
});

describe('Flow Engine — call flow captures return', () => {
  it('call captures return value in out', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    // Simulate a flow def inline (normally loaded from file)
    defs.set('myFlow', {
      kind: 'flow',
      params: ['x'],
      path: '',
      steps: [
        { action: 'log', text: 'in flow {{x}}' },
        { action: 'return', value: { value: 'done' } },
      ],
      info: { type: 'subflow', parameters: ['x'], returns: 'string' },
    } as any);

    await runSteps(mockPage(), [
      { action: 'call', name: 'myFlow', args: ['hello'], out: 'result' },
      { action: 'log', text: 'got {{result}}' },
    ], vars, results, defs);

    expect(vars.get('result')).toBe('done');
    const logs = results.filter(r => r.action === 'log');
    expect(logs[1].data).toBe('got done');
  });
});

describe('validateSteps — subflow', () => {
  it('def flow requires path', () => {
    const errors = validateSteps([{ action: 'def', type: 'flow', name: 'x' } as any]);
    expect(errors[0]).toContain('requires "path"');
  });

  it('def flow forbids items', () => {
    const errors = validateSteps([{ action: 'def', type: 'flow', name: 'x', path: './f.json', items: [] } as any]);
    expect(errors[0]).toContain('cannot have "items"');
  });

  it('return requires value', () => {
    const errors = validateSteps([{ action: 'return' }]);
    expect(errors[0]).toContain('requires "value"');
  });
});

describe('Flow Engine — subflow safety', () => {
  it('$ret fallback symmetric with out (Option B)', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    // func def with no return — last step result should go to both out and $ret
    defs.set('noReturn', { kind: 'block', params: [], body: [
      { action: 'log', text: 'inner' },
    ] });

    await runSteps(mockPage(), [
      { action: 'call', name: 'noReturn', out: 'result' },
    ], vars, results, defs);

    expect(vars.get('result')).toBe('inner');
    expect(vars.get('$ret')).toBe('inner');
  });

  it('cycle detection catches A->A', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    defs.set('loopFlow', {
      kind: 'flow', params: [], path: '/fake', steps: [
        { action: 'call', name: 'loopFlow' },
      ], info: { type: 'subflow' },
    } as any);

    const outcome = await runSteps(mockPage(), [
      { action: 'call', name: 'loopFlow' },
    ], vars, results, defs, 0, { callStack: [] });

    expect(outcome.success).toBe(false);
    const err = results.find(r => !r.success);
    expect(err?.error).toContain('cycle detected');
  });

  it('max call depth protection', async () => {
    const vars = new VarStore();
    const results: any[] = [];
    const defs = emptyDefs();

    defs.set('deep', {
      kind: 'flow', params: [], path: '/fake', steps: [
        { action: 'log', text: 'deep' },
      ], info: { type: 'subflow' },
    } as any);

    const outcome = await runSteps(mockPage(), [
      { action: 'call', name: 'deep' },
    ], vars, results, defs, 0, { callDepth: 21 });

    expect(outcome.success).toBe(false);
    expect(results.find(r => !r.success)?.error).toContain('Max call depth');
  });
});
