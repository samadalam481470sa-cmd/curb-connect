// Small HTTP helpers on top of node:http: body parsing with a size limit, cookies, and the
// security headers every response carries.
import type { IncomingMessage, ServerResponse } from 'node:http';

export const MAX_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A cookie we did not set; ignore it.
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  secure: boolean;
  sameSite?: 'Lax' | 'Strict';
}

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  return parts.join('; ');
}

export function appendCookie(res: ServerResponse, cookie: string) {
  const existing = res.getHeader('set-cookie');
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('set-cookie', [...list, cookie]);
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mediaType(req: IncomingMessage): string {
  return (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Form posts from this server's own pages. */
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  if (mediaType(req) !== 'application/x-www-form-urlencoded') {
    throw new HttpError(415, 'Expected a form submission.');
  }
  return new URLSearchParams(await readBody(req));
}

/** JSON API calls. Requiring application/json means a plain cross-site form cannot reach them. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (mediaType(req) !== 'application/json') throw new HttpError(415, 'Expected application/json.');
  let value: unknown;
  try {
    value = JSON.parse(await readBody(req));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export function securityHeaders(res: ServerResponse) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  // same-origin keeps the Origin header on our own form posts and sends no Referer to other sites.
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('cache-control', 'no-store');
}

export function sendHtml(res: ServerResponse, status: number, html: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function redirect(res: ServerResponse, location: string, status = 303) {
  res.statusCode = status;
  res.setHeader('location', location);
  res.end();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
