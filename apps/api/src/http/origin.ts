// Same-origin enforcement for unsafe methods (CSRF defense in depth next to SameSite=Lax cookies).
// Browsers always send Origin (and Sec-Fetch-Site) on cross-origin POST/PUT/PATCH/DELETE, so:
//   - Origin present and not an allowed origin            -> 403 origin_rejected
//   - Sec-Fetch-Site: cross-site (with no allowed Origin) -> 403 origin_rejected
// Non-browser clients (CLI, server-to-server, tests) send neither and are not CSRF vectors; they
// still need a valid session. Routes authorized by a capability in the URL (signed uploads) opt
// out with `config: { allowCrossOrigin: true }`.
import type { FastifyInstance } from 'fastify';
import { problem } from './problem';

declare module 'fastify' {
  interface FastifyContextConfig {
    allowCrossOrigin?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerOriginCheck(app: FastifyInstance): void {
  const allowed = new Set([app.config.appOrigin, app.config.apiOrigin]);
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.routeOptions.config?.allowCrossOrigin) return;
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (origin === 'null' || !allowed.has(origin)) throw problem('origin_rejected');
      return;
    }
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site') throw problem('origin_rejected');
  });
}
