// Adversarial probes (security review): open redirect via returnTo and log redaction of capabilities.
import { describe, expect, it } from 'vitest';
import { redactPath } from './logger';
import { safeReturnTo } from './modules/auth/index';

const APP = 'http://localhost:3000';

describe('safeReturnTo rejects open redirects', () => {
  it.each([
    '//evil.example/x',
    '/\\evil.example',
    '\\evil.example',
    'https://evil.example/',
    'http://localhost:3000.evil.example/',
    'javascript:alert(1)',
    'data:text/html,hi',
    '/\tevil',
    ' //evil.example',
    'evil.example',
    'https://user@evil.example/',
  ])('%s -> /', (value) => {
    expect(safeReturnTo(value, APP, [])).toBe('/');
  });

  it('keeps same-site paths and allowlisted origins (as paths only)', () => {
    expect(safeReturnTo('/jobs/1?tab=a#b', APP, [])).toBe('/jobs/1?tab=a#b');
    expect(safeReturnTo('http://localhost:3000/team', APP, [])).toBe('/team');
  });
});

describe('redactPath hides capabilities in logged URLs', () => {
  it('redacts storage tokens and OIDC/invitation query values', () => {
    expect(redactPath('/v1/storage/object/abc.def?x=1')).toBe('/v1/storage/object/[redacted]?x=1');
    expect(redactPath('/v1/storage/upload/abc.def')).toBe('/v1/storage/upload/[redacted]');
    const cb = redactPath('/v1/auth/callback/dev?code=SECRET&state=S2&iss=x');
    expect(cb).not.toContain('SECRET');
    expect(cb).not.toContain('S2');
    expect(redactPath('/x?Token=abc')).not.toContain('abc');
  });
});
