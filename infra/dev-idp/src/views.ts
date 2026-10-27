// Minimal HTML for the stand-in provider's own pages. Everything interpolated is escaped. The
// pages carry a strict CSP (inline styles only, no scripts) and say DEVELOPMENT ONLY prominently.
import type { DevIdentity } from './identities';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

const STYLE = `
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; background: #f4f4f1; color: #1d1d1b; }
  main { max-width: 34rem; margin: 2rem auto; padding: 0 1rem; }
  .banner { background: #8a1c1c; color: #fff; padding: .75rem 1rem; font-weight: 700; text-align: center; }
  h1 { font-size: 1.4rem; margin: 1.5rem 0 .5rem; }
  p.note { color: #55554f; font-size: .9rem; }
  form.pick { display: grid; gap: .5rem; margin: 1rem 0; }
  button { font: inherit; text-align: left; padding: .75rem 1rem; border: 1px solid #b9b9b0;
           border-radius: .5rem; background: #fff; cursor: pointer; }
  button:hover, button:focus-visible { border-color: #1d1d1b; outline: 2px solid #1d1d1b; }
  button .who { font-weight: 600; display: block; }
  button .meta { font-size: .85rem; color: #55554f; }
  button.cancel { text-align: center; background: transparent; }
  code { background: #e7e7e1; padding: 0 .25rem; border-radius: .25rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #1b1b19; color: #ecece6; }
    button { background: #2a2a27; color: #ecece6; border-color: #55554f; }
    p.note, button .meta { color: #b9b9b0; }
    code { background: #33332f; }
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="banner" role="note">DEVELOPMENT ONLY: stand-in identity provider with fictional test identities. Never deploy.</div>
<main>${body}</main>
</body>
</html>`;
}

export function loginPage(input: {
  uid: string;
  clientId: string;
  identities: readonly DevIdentity[];
  error?: string;
}): string {
  const action = `/interaction/${encodeURIComponent(input.uid)}`;
  const buttons = input.identities
    .map(
      (identity) => `
    <button type="submit" name="sub" value="${escapeHtml(identity.sub)}">
      <span class="who">${escapeHtml(identity.name)} (${escapeHtml(identity.roleLabel)})</span>
      <span class="meta">${escapeHtml(identity.companyLabel)} &middot; ${escapeHtml(identity.email)}</span>
    </button>`,
    )
    .join('');
  return page(
    'Sign in (development stand-in)',
    `
  <h1>Choose a test identity</h1>
  <p class="note">Signing in to <code>${escapeHtml(input.clientId)}</code>. These people are fictional.
  This page replaces a real provider such as Microsoft Entra ID on your machine only.</p>
  ${input.error ? `<p role="alert"><strong>${escapeHtml(input.error)}</strong></p>` : ''}
  <form class="pick" method="post" action="${action}/login" autocomplete="off">${buttons}
  </form>
  <form method="post" action="${action}/abort">
    <button type="submit" class="cancel">Cancel sign-in</button>
  </form>`,
  );
}

export function homePage(issuer: string, identities: readonly DevIdentity[]): string {
  const rows = identities
    .map(
      (i) =>
        `<li><strong>${escapeHtml(i.name)}</strong> (${escapeHtml(i.roleLabel)}, ${escapeHtml(i.companyLabel)}): <code>${escapeHtml(i.sub)}</code></li>`,
    )
    .join('');
  return page(
    'Development identity provider',
    `
  <h1>Stand-in OpenID Connect provider</h1>
  <p>Issuer <code>${escapeHtml(issuer)}</code>. Discovery:
  <code>${escapeHtml(issuer)}/.well-known/openid-configuration</code></p>
  <p>Seeded test identities:</p>
  <ul>${rows}</ul>`,
  );
}

export function errorPage(message: string): string {
  return page('Sign-in error (development stand-in)', `<h1>Something went wrong</h1><p>${escapeHtml(message)}</p>`);
}
