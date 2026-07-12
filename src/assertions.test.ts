import { describe, expect, it } from 'vitest';
import { runAssertions } from './assertions';

describe('runAssertions', () => {
  it('passes when assertions are undefined', () => {
    expect(runAssertions('anything', undefined)).toEqual({ passed: true, failures: [] });
  });

  it('passes when all must_contain strings are present', () => {
    expect(runAssertions('Use POST and return 401.', {
      must_contain: ['POST', '401'],
    })).toEqual({ passed: true, failures: [] });
  });

  it('fails when one must_contain string is missing', () => {
    const result = runAssertions('Use POST.', { must_contain: ['POST', '401'] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('Output must contain: 401');
  });

  it('matches must_contain case-insensitively', () => {
    expect(runAssertions('Use post for login.', {
      must_contain: ['POST'],
    })).toEqual({ passed: true, failures: [] });
  });

  it('passes when must_not_contain strings are absent', () => {
    expect(runAssertions('Use POST /login.', {
      must_not_contain: ['GET /login'],
    })).toEqual({ passed: true, failures: [] });
  });

  it('fails when a must_not_contain string is present', () => {
    const result = runAssertions('Use GET /login.', { must_not_contain: ['get /login'] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('Output must not contain: get /login');
  });

  it('passes when regex patterns match', () => {
    expect(runAssertions('Return workspace-123 in the response.', {
      regex_match: ['workspace-[0-9]+'],
    })).toEqual({ passed: true, failures: [] });
  });

  it('fails when a regex pattern does not match', () => {
    const result = runAssertions('Return workspace id.', { regex_match: ['workspace-[0-9]+'] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('Output must match regex: workspace-[0-9]+');
  });

  it('passes when output length is at least min_length', () => {
    expect(runAssertions('12345', { min_length: 5 })).toEqual({ passed: true, failures: [] });
  });

  it('fails when output length is below min_length', () => {
    const result = runAssertions('1234', { min_length: 5 });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('Output length must be at least 5 characters');
  });

  it('passes when output length is at most max_length', () => {
    expect(runAssertions('12345', { max_length: 5 })).toEqual({ passed: true, failures: [] });
  });

  it('fails when output length exceeds max_length', () => {
    const result = runAssertions('123456', { max_length: 5 });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('Output length must be at most 5 characters');
  });

  it('collects multiple failures without short-circuiting', () => {
    const result = runAssertions('GET /login', {
      must_contain: ['POST', '401'],
      must_not_contain: ['GET /login'],
      regex_match: ['workspace-[0-9]+'],
      min_length: 50,
      max_length: 5,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'Output must contain: POST',
      'Output must contain: 401',
      'Output must not contain: GET /login',
      'Output must match regex: workspace-[0-9]+',
      'Output length must be at least 50 characters',
      'Output length must be at most 5 characters',
    ]);
  });

  it('passes when all assertion types pass together', () => {
    expect(runAssertions('Use POST /invites and return 401.', {
      must_contain: ['POST', '401'],
      must_not_contain: ['GET /login'],
      regex_match: ['POST\\s+/invites'],
      min_length: 10,
      max_length: 100,
    })).toEqual({ passed: true, failures: [] });
  });

  it('reports multiple failures when all assertion types are combined', () => {
    const result = runAssertions('GET /login', {
      must_contain: ['POST'],
      must_not_contain: ['GET /login'],
      regex_match: ['workspace-[0-9]+'],
      min_length: 20,
      max_length: 5,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'Output must contain: POST',
      'Output must not contain: GET /login',
      'Output must match regex: workspace-[0-9]+',
      'Output length must be at least 20 characters',
      'Output length must be at most 5 characters',
    ]);
  });
});
