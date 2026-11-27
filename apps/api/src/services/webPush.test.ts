// Web Push crypto checks: the VAPID JWT is well-formed and signed, and the encrypted
// payload decrypts back to the original with the subscription's private key (the same
// math a browser performs). No network: fetch is stubbed.
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { generateVapidKeys, pushConfigured, sendWebPush } from './webPush';

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromB64url = (s: string): Buffer =>
  Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64');

function configWith(keys: { publicKey: string; privateKey: string } | null): AppConfig {
  return {
    push: {
      vapidPublicKey: keys?.publicKey,
      vapidPrivateKey: keys?.privateKey,
      subject: keys ? 'mailto:ops@example.test' : undefined,
    },
  } as AppConfig;
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const out: Buffer[] = [];
  let t = Buffer.alloc(0);
  let produced = 0;
  for (let i = 1; produced < length; i += 1) {
    t = createHmac('sha256', prk)
      .update(Buffer.concat([t, info, Buffer.from([i])]))
      .digest();
    out.push(t);
    produced += t.length;
  }
  return Buffer.concat(out).subarray(0, length);
}

/** Decrypt an aes128gcm body the way a browser would, given the UA private key + auth. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20] ?? 0;
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const uaPublic = ua.getPublicKey();
  const shared = ua.computeSecret(asPublic);
  const prk = hkdfExtract(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = hkdfExpand(prk, keyInfo, 32);
  const prk2 = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk2, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk2, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  // Strip the final-record delimiter (0x02) and any zero padding after it.
  const end = plain.lastIndexOf(0x02);
  return plain.subarray(0, end).toString('utf8');
}

describe('webPush', () => {
  it('reports not configured without keys', async () => {
    const config = configWith(null);
    expect(pushConfigured(config)).toBe(false);
    const result = await sendWebPush(
      config,
      { endpoint: 'https://push.example.test/x', p256dh: 'x', auth: 'y' },
      { title: 'T', body: null, link: null },
    );
    expect(result).toMatchObject({ ok: false, reason: 'push_not_configured' });
  });

  it('signs a verifiable VAPID JWT and encrypts a decryptable payload', async () => {
    const keys = generateVapidKeys();
    const config = configWith(keys);
    expect(pushConfigured(config)).toBe(true);

    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const authSecret = Buffer.from('0123456789abcdef');
    const sub = {
      endpoint: 'https://push.example.test/sub/1',
      p256dh: b64url(ua.getPublicKey()),
      auth: b64url(authSecret),
    };

    const captured: { headers?: Record<string, string>; body?: Buffer } = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured.headers = init.headers as Record<string, string>;
      captured.body = Buffer.from(init.body as Uint8Array);
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const result = await sendWebPush(
      config,
      sub,
      { title: 'Job assigned', body: 'Framing at 12 Oak St', link: '/assignments' },
      fakeFetch,
    );
    expect(result).toEqual({ ok: true, status: 201 });
    expect(captured.headers).toBeDefined();

    const auth = captured.headers?.Authorization ?? '';
    expect(auth.startsWith('vapid t=')).toBe(true);
    expect(auth).toContain(`k=${keys.publicKey}`);
    const jwt = auth.slice('vapid t='.length).split(',')[0] ?? '';
    const [headerB64, claimsB64, sigB64] = jwt.split('.');
    const header = JSON.parse(fromB64url(headerB64 ?? '').toString('utf8')) as { alg: string };
    const claims = JSON.parse(fromB64url(claimsB64 ?? '').toString('utf8')) as {
      aud: string;
      sub: string;
    };
    expect(header.alg).toBe('ES256');
    expect(claims.aud).toBe('https://push.example.test');
    expect(claims.sub).toBe('mailto:ops@example.test');
    const pub = fromB64url(keys.publicKey);
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
      format: 'jwk',
    });
    const valid = verify(
      'sha256',
      Buffer.from(`${headerB64}.${claimsB64}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      fromB64url(sigB64 ?? ''),
    );
    expect(valid).toBe(true);

    const plain = decrypt(captured.body ?? Buffer.alloc(0), ua.getPrivateKey(), authSecret);
    expect(JSON.parse(plain)).toEqual({
      title: 'Job assigned',
      body: 'Framing at 12 Oak St',
      link: '/assignments',
    });
  });

  it('marks 410 as gone', async () => {
    const keys = generateVapidKeys();
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const fakeFetch = (async () => new Response(null, { status: 410 })) as typeof fetch;
    const result = await sendWebPush(
      configWith(keys),
      {
        endpoint: 'https://push.example.test/sub/2',
        p256dh: b64url(ua.getPublicKey()),
        auth: b64url(Buffer.from('0123456789abcdef')),
      },
      { title: 'T', body: null, link: null },
      fakeFetch,
    );
    expect(result).toMatchObject({ ok: false, gone: true, reason: 'push_http_410' });
  });
});
