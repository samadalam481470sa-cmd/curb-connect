// Server-rendered pages. Plain HTML forms with no page scripts, so the CSP can forbid all script.
import type { MailConnection, Provider, User } from './db';
import { escapeHtml as e } from './http';

export interface ProviderSetup {
  google: boolean;
  microsoft: boolean;
}

const PROVIDER_LABEL: Record<Provider, string> = { google: 'Gmail', microsoft: 'Outlook' };

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · Curb Connect Mail</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main class="page">
<p class="brand">Curb Connect <span>Mail</span></p>
${body}
</main>
</body>
</html>`;
}

function messages(notice?: string, error?: string): string {
  return [
    error ? `<p class="alert alert--error" role="alert">${e(error)}</p>` : '',
    notice ? `<p class="alert alert--ok" role="status">${e(notice)}</p>` : '',
  ].join('');
}

function providerButtons(setup: ProviderSetup, verb: string): string {
  const button = (provider: Provider, label: string, configured: boolean) =>
    configured
      ? `<a class="provider provider--${provider}" href="/auth/${provider === 'google' ? 'gmail' : 'outlook'}/start?purpose=signin">${e(verb)} with ${label}</a>`
      : `<span class="provider provider--off" aria-disabled="true">${e(verb)} with ${label} (not set up yet)</span>`;
  return `<div class="divider"><span>or</span></div>
<div class="providers">
${button('google', 'Google (Gmail)', setup.google)}
${button('microsoft', 'Microsoft (Outlook)', setup.microsoft)}
</div>`;
}

export function signInPage(opts: {
  setup: ProviderSetup;
  login?: string;
  error?: string;
  notice?: string;
}): string {
  return layout(
    'Sign in',
    `<section class="card">
<h1>Sign in</h1>
${messages(opts.notice, opts.error)}
<form method="post" action="/signin" class="form">
<label>Username or email
<input name="login" autocomplete="username" required maxlength="254" value="${e(opts.login ?? '')}" autofocus>
</label>
<label>Password
<input name="password" type="password" autocomplete="current-password" required maxlength="200">
</label>
<label class="check"><input type="checkbox" name="remember" value="1" checked> Keep me signed in for 30 days</label>
<button type="submit">Sign in</button>
</form>
<p class="small">New here? <a href="/signup">Create an account</a></p>
${providerButtons(opts.setup, 'Sign in')}
</section>`,
  );
}

export interface SignUpValues {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  company: string;
}

export function signUpPage(opts: {
  setup: ProviderSetup;
  values?: Partial<SignUpValues>;
  error?: string;
}): string {
  const v = opts.values ?? {};
  return layout(
    'Create account',
    `<section class="card">
<h1>Create account</h1>
${messages(undefined, opts.error)}
<form method="post" action="/signup" class="form">
<label>Full name
<input name="fullName" autocomplete="name" required maxlength="120" value="${e(v.fullName ?? '')}" autofocus>
</label>
<label>Username
<input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._\\-]{3,32}" aria-describedby="username-hint" value="${e(v.username ?? '')}">
</label>
<small id="username-hint">3 to 32 letters, numbers, dots, dashes or underscores.</small>
<label>Email
<input name="email" type="email" autocomplete="email" required maxlength="254" value="${e(v.email ?? '')}">
</label>
<label>Phone (optional)
<input name="phone" type="tel" autocomplete="tel" maxlength="40" value="${e(v.phone ?? '')}">
</label>
<label>Company (optional)
<input name="company" autocomplete="organization" maxlength="120" value="${e(v.company ?? '')}">
</label>
<label>Password
<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200" aria-describedby="password-hint">
</label>
<small id="password-hint">At least 8 characters.</small>
<label>Confirm password
<input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
</label>
<label class="check"><input type="checkbox" name="remember" value="1" checked> Keep me signed in for 30 days</label>
<button type="submit">Create account</button>
</form>
<p class="small">Already have an account? <a href="/signin">Sign in</a></p>
${providerButtons(opts.setup, 'Continue')}
</section>`,
  );
}

function connectionRow(
  provider: Provider,
  connection: MailConnection | undefined,
  configured: boolean,
): string {
  const label = PROVIDER_LABEL[provider];
  const path = provider === 'google' ? 'gmail' : 'outlook';
  if (connection) {
    return `<li><strong>${label}</strong>: connected as ${e(connection.email)}
<form method="post" action="/account/mail/${path}/disconnect" class="inline"><button type="submit" class="secondary">Disconnect</button></form></li>`;
  }
  if (!configured) return `<li><strong>${label}</strong>: not set up on this server yet</li>`;
  return `<li><strong>${label}</strong>: not connected <a class="button" href="/auth/${path}/start?purpose=connect">Connect ${label}</a></li>`;
}

export function accountPage(opts: {
  user: User;
  setup: ProviderSetup;
  identities: { provider: Provider; email: string }[];
  connections: MailConnection[];
  sent: { provider: Provider; to: string; subject: string; sentAt: string }[];
  notice?: string;
  error?: string;
}): string {
  const { user } = opts;
  const byProvider = new Map(opts.connections.map((c) => [c.provider, c]));
  const linked = opts.identities.length
    ? opts.identities
        .map((i) => `${i.provider === 'google' ? 'Google' : 'Microsoft'} (${e(i.email)})`)
        .join(', ')
    : 'none';
  const linkable = (['google', 'microsoft'] as const)
    .filter((p) => opts.setup[p] && !opts.identities.some((i) => i.provider === p))
    .map(
      (p) =>
        ` <a href="/auth/${p === 'google' ? 'gmail' : 'outlook'}/start?purpose=signin">Link ${p === 'google' ? 'Google' : 'Microsoft'} sign-in</a>`,
    )
    .join('');
  const sendOptions = opts.connections
    .map(
      (c) => `<option value="${c.provider}">${PROVIDER_LABEL[c.provider]}: ${e(c.email)}</option>`,
    )
    .join('');
  const sent = opts.sent.length
    ? `<ul class="list">${opts.sent
        .map(
          (s) =>
            `<li>${e(new Date(s.sentAt).toLocaleString('en-US'))}: to ${e(s.to)} by ${PROVIDER_LABEL[s.provider]}, "${e(s.subject)}"</li>`,
        )
        .join('')}</ul>`
    : '<p class="small">No invoice emails sent yet.</p>';
  return layout(
    'Your account',
    `<section class="card card--wide">
<div class="row"><h1>Hi, ${e(user.fullName || user.username)}</h1>
<form method="post" action="/signout" class="inline"><button type="submit" class="secondary">Sign out</button></form></div>
${messages(opts.notice, opts.error)}
<p class="small">Signed in as <strong>${e(user.username)}</strong>. Linked sign-ins: ${linked}.<span class="links">${linkable}</span></p>

<h2>Your information</h2>
<form method="post" action="/account/profile" class="form">
<label>Full name<input name="fullName" autocomplete="name" maxlength="120" value="${e(user.fullName)}"></label>
<label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" value="${e(user.email)}"></label>
<label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="40" value="${e(user.phone)}"></label>
<label>Company<input name="company" autocomplete="organization" maxlength="120" value="${e(user.company)}"></label>
<button type="submit">Save information</button>
</form>

<h2>${user.passwordHash ? 'Change password' : 'Set a password'}</h2>
<form method="post" action="/account/password" class="form">
<input type="text" name="username" autocomplete="username" value="${e(user.username)}" hidden>
${user.passwordHash ? '<label>Current password<input name="current" type="password" autocomplete="current-password" required maxlength="200"></label>' : '<p class="small">You signed up with Google or Microsoft. Set a password to also sign in with your username.</p>'}
<label>New password<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
<label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
<button type="submit">${user.passwordHash ? 'Change password' : 'Set password'}</button>
</form>

<h2>Email for invoices</h2>
<p class="small">Connect the mailbox that sends your invoices. Messages go out from your own account.</p>
<ul class="list">
${connectionRow('google', byProvider.get('google'), opts.setup.google)}
${connectionRow('microsoft', byProvider.get('microsoft'), opts.setup.microsoft)}
</ul>

<h2>Send an invoice email</h2>
${
  opts.connections.length
    ? `<form method="post" action="/account/send" class="form">
<label>Send from<select name="provider">${sendOptions}</select></label>
<label>To<input name="to" type="email" required maxlength="254"></label>
<label>Subject<input name="subject" required maxlength="200" value="Invoice from ${e(user.company || user.fullName || 'Curb Connect')}"></label>
<label>Message<textarea name="text" rows="8" required maxlength="20000"></textarea></label>
<button type="submit">Send invoice email</button>
</form>`
    : '<p class="small">Connect Gmail or Outlook above to send invoice emails.</p>'
}

<h2>Recent invoice emails</h2>
${sent}
</section>`,
  );
}

export function errorPage(status: number, message: string): string {
  return layout(
    `Error ${status}`,
    `<section class="card"><h1>Something went wrong</h1><p class="alert alert--error">${e(message)}</p><p class="small"><a href="/">Back</a></p></section>`,
  );
}

export const CSS = `*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
.page{max-width:720px;margin:0 auto;padding:32px 16px}
.brand{font-weight:700;letter-spacing:.04em;color:#38bdf8;margin:0 0 16px;text-align:center}
.brand span{color:#e2e8f0;font-weight:400}
.card{background:#111c33;border:1px solid #1e2d4d;border-radius:12px;padding:24px;max-width:440px;margin:0 auto}
.card--wide{max-width:none}
h1{font-size:1.5rem;margin:0 0 16px}
h2{font-size:1.1rem;margin:28px 0 8px;border-top:1px solid #1e2d4d;padding-top:20px}
.form{display:grid;gap:12px}
.form>small{margin-top:-8px}
label{display:grid;gap:4px;font-size:.9rem;color:#cbd5e1}
label.check{display:flex;align-items:center;gap:8px}
input,select,textarea{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0b1324;color:#f8fafc}
input:focus,select:focus,textarea:focus{outline:2px solid #38bdf8;outline-offset:1px}
small,.small{font-size:.85rem;color:#94a3b8}
button,.button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:0;background:#0ea5e9;color:#04111f;cursor:pointer;text-decoration:none;display:inline-block}
button.secondary{background:#1e293b;color:#e2e8f0;border:1px solid #334155}
a{color:#7dd3fc}
.alert{padding:10px 12px;border-radius:8px;margin:0 0 12px}
.alert--error{background:#3f1d24;color:#fecdd3}
.alert--ok{background:#123326;color:#bbf7d0}
.divider{display:flex;align-items:center;gap:12px;color:#64748b;margin:20px 0 12px}
.divider::before,.divider::after{content:"";flex:1;border-top:1px solid #1e2d4d}
.providers{display:grid;gap:10px}
.provider{display:block;text-align:center;padding:10px 12px;border-radius:8px;font-weight:600;text-decoration:none;border:1px solid #334155;background:#f8fafc;color:#0f172a}
.provider--microsoft{background:#e2e8f0}
.provider--off{background:transparent;color:#64748b;border-style:dashed}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px}
.inline{display:inline}
.list{padding-left:18px;display:grid;gap:8px}
.list li .inline,.list li .button{margin-left:8px}
.links a{margin-left:12px}
`;
