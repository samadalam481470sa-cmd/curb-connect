import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { deriveKey, pkceChallenge, seal, unseal } from './crypto';
import { buildMime, encodeWord, formatAddress } from './mime';
import { hasScope } from './providers';
import { FileStore } from './store';
import { safeReturnPath } from './tickets';

describe('crypto', () => {
  const key = deriveKey(Buffer.alloc(32, 1), 'refresh-token');

  it('round-trips and binds the value to its owner', () => {
    const sealed = seal(key, 'refresh-123', 'gmail:org:user');
    expect(sealed).not.toContain('refresh-123');
    expect(unseal(key, sealed, 'gmail:org:user')).toBe('refresh-123');
    expect(() => unseal(key, sealed, 'gmail:org:other-user')).toThrow();
    expect(() =>
      unseal(deriveKey(Buffer.alloc(32, 2), 'refresh-token'), sealed, 'gmail:org:user'),
    ).toThrow();
  });

  it('derives different keys per purpose', () => {
    expect(deriveKey(Buffer.alloc(32, 1), 'a').equals(deriveKey(Buffer.alloc(32, 1), 'b'))).toBe(
      false,
    );
  });

  it('computes the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('mime', () => {
  it('blocks header injection through the subject and sender name', () => {
    const raw = buildMime(
      {
        to: 'a@b.test',
        subject: 'Hi\r\nBcc: victim@x.test',
        text: 'x',
        fromName: 'Acme\nBcc: v@x.test',
        attachments: [],
      },
      'me@gmail.com',
    );
    expect(raw).not.toMatch(/^Bcc:/m);
  });

  it('rejects recipient lists and malformed addresses', () => {
    expect(() =>
      buildMime(
        { to: 'a@b.test, c@d.test', subject: 's', text: 't', attachments: [] },
        'me@x.test',
      ),
    ).toThrow();
    expect(() =>
      buildMime({ to: 'not-an-address', subject: 's', text: 't', attachments: [] }, 'me@x.test'),
    ).toThrow();
  });

  it('encodes non-ASCII subjects and names', () => {
    expect(encodeWord('Factura — enero')).toMatch(/^=\?UTF-8\?B\?/);
    expect(formatAddress('me@x.test', 'Peña Roofing')).toMatch(/^=\?UTF-8\?B\?.+\?= <me@x\.test>$/);
    expect(formatAddress('me@x.test', 'Acme "Roofing"')).toBe('"Acme Roofing" <me@x.test>');
  });

  it('keeps base64 lines within 76 characters', () => {
    const raw = buildMime(
      {
        to: 'a@b.test',
        subject: 's',
        text: 'x'.repeat(500),
        attachments: [
          {
            filename: 'a.pdf',
            contentType: 'application/pdf',
            contentBase64: Buffer.alloc(2000, 1).toString('base64'),
          },
        ],
      },
      'me@x.test',
      { boundary: 'B' },
    );
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    expect(raw).toContain('--B--');
  });
});

describe('scopes', () => {
  it('accepts full and short Microsoft scope names, case-insensitively', () => {
    expect(
      hasScope(['https://graph.microsoft.com/Mail.Send'], 'https://graph.microsoft.com/Mail.Send'),
    ).toBe(true);
    expect(hasScope(['mail.send', 'User.Read'], 'https://graph.microsoft.com/Mail.Send')).toBe(
      true,
    );
    expect(hasScope(['User.Read'], 'https://graph.microsoft.com/Mail.Send')).toBe(false);
  });
});

describe('return paths', () => {
  it('only allows same-site paths', () => {
    expect(safeReturnPath('/billing')).toBe('/billing');
    expect(safeReturnPath('//evil.test')).toBe('/settings/email');
    expect(safeReturnPath('https://evil.test')).toBe('/settings/email');
    expect(safeReturnPath('/\\evil.test')).toBe('/settings/email');
  });
});

describe('config', () => {
  const base = {
    MAILER_SHARED_SECRET: 's'.repeat(40),
    MAILER_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  };
  it('starts with no provider keys and reports them as unconfigured', () => {
    const c = loadConfig(base);
    expect(c.google).toBeNull();
    expect(c.microsoft).toBeNull();
    expect(c.port).toBe(4300);
  });
  it('refuses placeholders and half-set provider keys', () => {
    expect(() =>
      loadConfig({ ...base, MAILER_SHARED_SECRET: '<random-secret-at-least-32-chars>' }),
    ).toThrow(/MAILER_SHARED_SECRET/);
    expect(() => loadConfig({ ...base, GOOGLE_MAIL_CLIENT_ID: 'id-only' })).toThrow(/Google/);
  });
  it('requires https in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/https/);
  });
});

describe('file store', () => {
  it('persists mailboxes across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mailer-'));
    try {
      const file = join(dir, 'mailboxes.json');
      const a = await FileStore.open(file);
      await a.upsertMailbox({
        orgId: 'o',
        userId: 'u',
        provider: 'gmail',
        email: 'me@gmail.com',
        displayName: null,
        sealedRefreshToken: 'v1.sealed',
        scopes: [],
        connectedAt: 't',
        updatedAt: 't',
      });
      await a.close();
      expect(await readFile(file, 'utf8')).toContain('me@gmail.com');
      const b = await FileStore.open(file);
      expect((await b.listMailboxes('o', 'u'))[0]?.email).toBe('me@gmail.com');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
