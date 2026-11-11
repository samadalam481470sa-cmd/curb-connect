// Adversarial probes (security review): open redirect via returnTo, log redaction of capabilities,
// and the injection / supply-chain / route-hardening invariants the money surface depends on.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../test/support/config';
import { type App, buildApp } from './app';
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

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Application sources only: tests are allowed to spawn processes and build fake code. */
function sourceFiles(relativeDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', 'dist', 'coverage'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(extname(entry.name)) || /\.tsx?$/.test(entry.name)) {
        if (!/\.(test|spec)\.tsx?$/.test(entry.name)) files.push(full);
      }
    }
  };
  walk(join(ROOT, relativeDir));
  return files;
}

describe('injection and supply-chain invariants', () => {
  it('never builds SQL from interpolated strings', () => {
    for (const file of sourceFiles('apps/api/src')) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/sql\.raw\s*\(/);
      expect(source, file).not.toMatch(/\.execute\(\s*`[^`]*\$\{/);
    }
  });

  it('never evaluates dynamic code or spawns processes from application code', () => {
    for (const file of [...sourceFiles('apps/api/src'), ...sourceFiles('apps/web/src')]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\beval\s*\(/);
      expect(source, file).not.toMatch(/new\s+Function\s*\(/);
      expect(source, file).not.toMatch(/from\s+'(node:)?child_process'/);
    }
  });

  it('gives every invoice, bill and network route a permission and limits the writes', () => {
    for (const name of ['invoices', 'bills', 'network']) {
      const source = readFileSync(join(ROOT, 'apps/api/src/modules', name, 'index.ts'), 'utf8');
      const routes = source.match(/app\.(?:get|post|patch|delete)\(/g) ?? [];
      const permissions = source.match(/permission: '/g) ?? [];
      const writes = source.match(/app\.(?:post|patch|delete)\(/g) ?? [];
      const limits = source.match(/rateLimit: \{/g) ?? [];
      expect(permissions.length, `${name}: every route declares a permission`).toBe(routes.length);
      expect(limits.length, `${name}: every write is rate limited`).toBeGreaterThanOrEqual(writes.length);
    }
  });

  it('has no credential patterns in tracked files', () => {
    expect(() =>
      execFileSync(process.execPath, [join(ROOT, 'scripts/security/secret-scan.mjs')], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});

describe('defence in depth on the exchange surface', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    '/v1/invoices',
    '/v1/bills',
    '/v1/ledger',
    '/v1/network/directory',
    '/v1/network/connections',
    '/v1/plumbing/projects',
  ])(
    'GET %s requires a session',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it('rejects a cross-site write with 403 before authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'origin_rejected' });
  });

  it('sets nosniff and a content security policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
  });
});
