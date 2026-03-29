import { describe, it, expect } from 'vitest';
import { buildErrorResult } from '../skills/pw-browse/scripts/common.js';

describe('buildErrorResult', () => {
  it('basic error with no extras', () => {
    const result = buildErrorResult('click failed', []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('click failed');
    expect(result.context).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.screenshot).toBeUndefined();
  });

  it('includes diagnostics context', () => {
    const result = buildErrorResult('fail', [], {
      url: 'http://localhost:3000/login',
      title: 'Login Page',
      session: 'dev',
      tab: 0,
    });
    expect(result.context?.url).toBe('http://localhost:3000/login');
    expect(result.context?.title).toBe('Login Page');
    expect(result.context?.session).toBe('dev');
    expect(result.context?.tab).toBe(0);
  });

  it('includes hook errors as warnings', () => {
    const result = buildErrorResult('action failed', ['hook1 broke', 'hook2 broke']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![0]).toContain('hook1 broke');
    expect(result.warnings![1]).toContain('hook2 broke');
  });

  it('hook errors preserved alongside diagnostics', () => {
    const result = buildErrorResult('fail', ['hook err'], {
      url: 'http://localhost',
      session: 'test',
    });
    expect(result.context?.url).toBe('http://localhost');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toContain('hook err');
  });

  it('challenge detected modifies error message', () => {
    const result = buildErrorResult('click failed', [], undefined, {
      detected: true,
      type: 'cloudflare',
    });
    expect(result.error).toContain('BOT CHALLENGE DETECTED');
    expect(result.error).toContain('CLOUDFLARE');
    expect(result.error).toContain('click failed');
    expect(result.challenge?.detected).toBe(true);
  });

  it('challenge not detected leaves error unchanged', () => {
    const result = buildErrorResult('click failed', [], undefined, {
      detected: false,
    });
    expect(result.error).toBe('click failed');
    expect(result.challenge).toBeUndefined();
  });

  it('includes screenshot path', () => {
    const result = buildErrorResult('fail', [], undefined, undefined, '/path/to/error.png');
    expect(result.screenshot).toBe('/path/to/error.png');
  });

  it('all fields together', () => {
    const result = buildErrorResult(
      'timeout',
      ['ext1 failed'],
      { url: 'http://site.com', title: 'Page', session: 'demo', tab: 2 },
      { detected: true, type: 'recaptcha' },
      '/screenshots/error-123.png',
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('BOT CHALLENGE');
    expect(result.error).toContain('timeout');
    expect(result.context?.session).toBe('demo');
    expect(result.context?.tab).toBe(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.screenshot).toBe('/screenshots/error-123.png');
    expect(result.challenge?.type).toBe('recaptcha');
  });
});
