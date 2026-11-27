// Web Push delivery (RFC 8030 transport, RFC 8291 payload encryption, RFC 8292 VAPID),
// implemented with Node's built-in crypto so no new dependency is needed. A push is only
// ever sent when the VAPID keys are configured; callers check `pushConfigured` first and
// record an honest not-connected state otherwise. Native APNs/FCM delivery is separate
// and stays gated on the owner's Apple Developer / Firebase accounts.
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from 'node:crypto';
import type { AppConfig } from '../config';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; gone: boolean; reason: string };

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromB64url = (s: string): Buffer =>
  Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64');

export function pushConfigured(config: AppConfig): boolean {
  return Boolean(config.push.vapidPublicKey && config.push.vapidPrivateKey && config.push.subject);
}

/** Generate a fresh VAPID key pair (base64url) for the operator to put in Render. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

function vapidJwt(config: AppConfig, endpoint: string): string {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: config.push.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const pub = fromB64url(config.push.vapidPublicKey ?? '');
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: config.push.vapidPrivateKey ?? '',
    },
    format: 'jwk',
  });
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(signature)}`;
}

/** HKDF-Extract (RFC 5869): PRK = HMAC(salt, IKM). */
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

/** HKDF-Expand (RFC 5869) with SHA-256. */
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

/** Encrypt the payload for one subscription (RFC 8291 "aes128gcm" content encoding). */
function encryptPayload(sub: PushSubscriptionKeys, payload: Buffer): Buffer {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const as = createECDH('prime256v1');
  as.generateKeys();
  const asPublic = as.getPublicKey();
  const sharedSecret = as.computeSecret(uaPublic);

  const prk = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdfExpand(prk, keyInfo, 32);

  const salt = randomBytes(16);
  const prk2 = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk2, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk2, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  // Single record: payload + final-record delimiter (0x02), no extra padding.
  const plaintext = Buffer.concat([payload, Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

export async function sendWebPush(
  config: AppConfig,
  sub: PushSubscriptionKeys,
  payload: { title: string; body: string | null; link: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PushSendResult> {
  if (!pushConfigured(config)) {
    return { ok: false, status: null, gone: false, reason: 'push_not_configured' };
  }
  let body: Buffer;
  let jwt: string;
  try {
    body = encryptPayload(sub, Buffer.from(JSON.stringify(payload), 'utf8'));
    jwt = vapidJwt(config, sub.endpoint);
  } catch {
    return { ok: false, status: null, gone: false, reason: 'push_encrypt_failed' };
  }
  let response: Response;
  try {
    response = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${config.push.vapidPublicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: new Uint8Array(body),
    });
  } catch {
    return { ok: false, status: null, gone: false, reason: 'push_network_error' };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, status: response.status };
  }
  return {
    ok: false,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
    reason: `push_http_${response.status}`,
  };
}
