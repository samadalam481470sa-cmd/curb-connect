// `npm run dev -w @fieldline/dev-idp`: the stand-in OIDC provider on http://localhost:4100.
// DEVELOPMENT ONLY. Configure with DEV_IDP_PORT, DEV_IDP_ISSUER, DEV_IDP_CLIENT_ID,
// DEV_IDP_CLIENT_SECRET (optional; unset = public PKCE client) and DEV_IDP_REDIRECT_URIS. The API's
// DEV_IDP_ISSUER / DEV_IDP_CLIENT_ID / DEV_IDP_CLIENT_SECRET must match.
import { createServer } from 'node:http';
import { clientsFromEnv, createDevIdp, DEV_IDP_DEFAULT_PORT } from './index';

const port = Number(process.env.DEV_IDP_PORT ?? DEV_IDP_DEFAULT_PORT);
const issuer = (process.env.DEV_IDP_ISSUER ?? `http://localhost:${port}`).replace(/\/+$/, '');
const clients = clientsFromEnv();
const { handler, identities } = createDevIdp({ issuer, clients });

const server = createServer(handler);
// Loopback only by default: anyone who can reach the IdP can sign in as any test identity.
const host = process.env.DEV_IDP_HOST ?? 'localhost';
server.listen(port, host, () => {
  console.info(`[dev-idp] DEVELOPMENT ONLY stand-in OIDC provider at ${issuer}`);
  console.info(`[dev-idp] discovery: ${issuer}/.well-known/openid-configuration`);
  for (const client of clients) {
    console.info(
      `[dev-idp] client ${client.clientId} (${client.clientSecret ? 'confidential' : 'public'}, PKCE required) -> ${client.redirectUris.join(', ')}`,
    );
  }
  console.info(`[dev-idp] test identities: ${identities.map((i) => i.sub).join(', ')}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
