// Key-checking proxy in front of the local model server (Ollama or any OpenAI-compatible server).
// The model server itself has no sign-in, so it is never exposed. Only this proxy is reached
// through the tunnel, and it forwards a request only when it carries the right bearer key.
// No dependencies. Run: HOME_AI_API_KEY=... node proxy.mjs
import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function keyMatches(header, key) {
  if (!key || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(key);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createProxy({ key, upstreamHost, upstreamPort }) {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (!keyMatches(req.headers.authorization, key)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    // Only the OpenAI-compatible routes are forwarded. Model management stays local.
    if (!/^\/v1\/(chat\/completions|models|completions|embeddings)(\?.*)?$/.test(req.url ?? '')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }
    const upstream = httpRequest(
      {
        host: upstreamHost,
        port: upstreamPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${upstreamHost}:${upstreamPort}`, authorization: '' },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"error":"model server unreachable"}');
    });
    req.pipe(upstream);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.HOME_AI_API_KEY;
  if (!key || key.length < 24) {
    console.error('HOME_AI_API_KEY must be set and at least 24 characters.');
    process.exit(1);
  }
  const port = Number(process.env.PROXY_PORT ?? 11500);
  createProxy({
    key,
    upstreamHost: process.env.UPSTREAM_HOST ?? '127.0.0.1',
    upstreamPort: Number(process.env.UPSTREAM_PORT ?? 11434),
  }).listen(port, '127.0.0.1', () => console.log(`home-ai proxy on 127.0.0.1:${port}`));
}
