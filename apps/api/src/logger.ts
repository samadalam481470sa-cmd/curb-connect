import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config';

/**
 * Query parameters that carry credentials or capabilities: OIDC codes/state, signed-URL signatures,
 * invitation tokens. They are replaced before a URL is logged (AIQ-088 S: logs must not contain
 * signed URLs, tokens or PII).
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'code',
  'state',
  'nonce',
  'token',
  'sig',
  'signature',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'id_token',
  'access_token',
  'session_state',
  'returnto',
  'email',
]);

/** Redacts sensitive query values; keeps the path so traffic stays debuggable. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  const kept: string[] = [];
  for (const [key, value] of params) {
    const safe = SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? '[redacted]' : value;
    kept.push(`${encodeURIComponent(key)}=${safe === '[redacted]' ? safe : encodeURIComponent(safe)}`);
  }
  return `${path}?${kept.join('&')}`;
}

/** Paths whose segments are capabilities (signed upload/download tokens). */
export function redactPath(url: string): string {
  return redactUrl(url).replace(/(\/v1\/storage\/(?:upload|object)\/)[^/?]+/, '$1[redacted]');
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.tokenHash',
  '*.email',
  '*.idToken',
  '*.accessToken',
  '*.code',
  '*.codeVerifier',
  '*.nonce',
  '*.uploadUrl',
  '*.viewUrl',
  '*.thumbnailUrl',
  '*.exif',
  '*.exifRestricted',
];

/**
 * pino options for Fastify. Structured JSON everywhere except local development, where logs are
 * pretty-printed. The request serializer logs method + redacted URL only (no IP, no headers).
 */
export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(request: { method: string; url: string; routeOptions?: { url?: string } }) {
        return { method: request.method, url: redactPath(request.url), route: request.routeOptions?.url };
      },
    },
    ...(config.env === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
  };
}
