// Request handler for the Curb Connect mail server: accounts, sessions, Google/Microsoft sign-in,
// Gmail/Outlook mail connections and invoice email sending.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config';
import type { OAuthPurpose, Provider, Store, User } from './db';
import {
  HttpError,
  appendCookie,
  parseCookies,
  readForm,
  readJson,
  redirect,
  securityHeaders,
  sendHtml,
  sendJson,
  serializeCookie,
} from './http';
import { SendError, isEmail, sendOnce, type OutgoingMail } from './mail';
import {
  GMAIL_SEND_SCOPE,
  authorizeUrl,
  clientFor,
  exchangeCode,
  microsoftMailbox,
  refreshAccessToken,
  verifyIdToken,
  type FetchLike,
} from './oauth';
import { CSS, accountPage, errorPage, signInPage, signUpPage, type ProviderSetup } from './pages';
import {
  DEFAULT_COST,
  decryptSecret,
  dummyPasswordHash,
  encryptSecret,
  hashPassword,
  passwordProblem,
  pkceChallenge,
  randomToken,
  sha256,
  verifyPassword,
  type ScryptCost,
} from './security';

export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MS = 12 * 60 * 60 * 1000;
const OAUTH_STATE_MS = 10 * 60 * 1000;

const NOTICES: Record<string, string> = {
  welcome: 'Your account is ready.',
  signed_out: 'You signed out.',
  saved: 'Your information was saved.',
  password: 'Your password was updated. Other devices were signed out.',
  connected_google: 'Gmail is connected. Invoice emails can now go out from it.',
  connected_microsoft: 'Outlook is connected. Invoice emails can now go out from it.',
  disconnected: 'The mailbox was disconnected.',
  sent: 'Invoice email sent.',
  linked: 'That sign-in is now linked to your account.',
  cancelled: 'Sign-in was cancelled.',
};

const PATH_PROVIDER: Record<string, Provider> = { gmail: 'google', outlook: 'microsoft' };
const PROVIDER_NAME: Record<Provider, string> = { google: 'Gmail', microsoft: 'Outlook' };
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const PHONE_RE = /^[0-9+()\-. xext]*$/i;

export interface AppDeps {
  config: Config;
  store: Store;
  fetchImpl?: FetchLike;
  passwordCost?: ScryptCost;
}

/** Counts failed sign-ins per username and per address and blocks bursts for 15 minutes. */
export class LoginLimiter {
  private readonly hits = new Map<string, { count: number; since: number }>();
  constructor(
    private readonly windowMs = 15 * 60 * 1000,
    private readonly perLogin = 5,
    private readonly perAddress = 30,
  ) {}

  private entry(key: string, now: number) {
    const hit = this.hits.get(key);
    if (!hit || now - hit.since > this.windowMs) return null;
    return hit;
  }

  /** Minutes left on a block, or 0 when the attempt may go ahead. */
  blockedFor(login: string, address: string, now = Date.now()): number {
    const byLogin = this.entry(`l:${login}`, now);
    const byAddress = this.entry(`a:${address}`, now);
    const blocked =
      (byLogin && byLogin.count >= this.perLogin ? byLogin : null) ??
      (byAddress && byAddress.count >= this.perAddress ? byAddress : null);
    if (!blocked) return 0;
    return Math.max(1, Math.ceil((blocked.since + this.windowMs - now) / 60_000));
  }

  fail(login: string, address: string, now = Date.now()) {
    if (this.hits.size > 10_000) this.hits.clear();
    for (const key of [`l:${login}`, `a:${address}`]) {
      const hit = this.entry(key, now);
      if (hit) hit.count += 1;
      else this.hits.set(key, { count: 1, since: now });
    }
  }

  reset(login: string) {
    this.hits.delete(`l:${login}`);
  }
}

function field(form: URLSearchParams, name: string, max = 254): string {
  return (form.get(name) ?? '').trim().slice(0, max);
}

export function suggestUsername(email: string, taken: (u: string) => boolean): string {
  let base = (email.split('@')[0] ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .toLowerCase()
    .slice(0, 24);
  if (base.length < 3) base = `user${base}`;
  if (!taken(base)) return base;
  for (let i = 0; i < 50; i += 1) {
    const candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}${randomToken(4)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()}`;
}

export function createApp(deps: AppDeps) {
  const { config, store } = deps;
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const cost = deps.passwordCost ?? DEFAULT_COST;
  const limiter = new LoginLimiter();
  const sessionCookie = config.secureCookies ? '__Host-mc_session' : 'mc_session';
  const oauthCookie = config.secureCookies ? '__Host-mc_oauth' : 'mc_oauth';
  const setup: ProviderSetup = {
    google: config.google !== null,
    microsoft: config.microsoft !== null,
  };

  const publicHost = new URL(config.publicUrl).host;
  const allowedHosts = new Set([
    publicHost,
    `localhost:${config.port}`,
    `127.0.0.1:${config.port}`,
  ]);
  const allowedOrigins = new Set(
    [...allowedHosts].map((h) => `${new URL(config.publicUrl).protocol}//${h}`),
  );

  // Helpers

  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin !== undefined) return allowedOrigins.has(origin);
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined) return site === 'same-origin';
    // No Origin and no Fetch Metadata: not a browser, so there is no cookie to forge a request with.
    return true;
  }

  function currentSession(req: IncomingMessage): { user: User; idHash: string } | null {
    const token = parseCookies(req.headers.cookie)[sessionCookie];
    if (!token) return null;
    const idHash = sha256(token);
    const user = store.sessionUser(idHash);
    return user ? { user, idHash } : null;
  }

  function startSession(
    res: ServerResponse,
    req: IncomingMessage,
    userId: number,
    remember: boolean,
  ) {
    const old = parseCookies(req.headers.cookie)[sessionCookie];
    if (old) store.deleteSession(sha256(old));
    const token = randomToken();
    store.createSession(sha256(token), userId, Date.now() + (remember ? REMEMBER_MS : SESSION_MS));
    store.markSignedIn(userId);
    appendCookie(
      res,
      serializeCookie(sessionCookie, token, {
        secure: config.secureCookies,
        maxAgeSeconds: remember ? REMEMBER_MS / 1000 : undefined,
      }),
    );
  }

  function clearCookie(res: ServerResponse, name: string) {
    appendCookie(
      res,
      serializeCookie(name, '', { secure: config.secureCookies, maxAgeSeconds: 0 }),
    );
  }

  function noticeFrom(url: URL): string | undefined {
    return NOTICES[url.searchParams.get('notice') ?? ''];
  }

  function renderAccount(user: User, extra: { notice?: string; error?: string } = {}) {
    return accountPage({
      user,
      setup,
      identities: store.identitiesFor(user.id),
      connections: store.connections(user.id),
      sent: store.recentSent(user.id),
      ...extra,
    });
  }

  async function accessToken(userId: number, provider: Provider, force: boolean): Promise<string> {
    const connection = store.connection(userId, provider);
    if (!connection) throw new SendError(`${PROVIDER_NAME[provider]} is not connected.`, 409);
    if (!force && connection.accessExpiresAt > Date.now() + 60_000) {
      return decryptSecret(connection.accessTokenEnc, config.tokenKey);
    }
    if (!connection.refreshTokenEnc) {
      throw new SendError(`Reconnect ${PROVIDER_NAME[provider]} to keep sending.`, 409);
    }
    let fresh;
    try {
      fresh = await refreshAccessToken(
        provider,
        config,
        fetchImpl,
        decryptSecret(connection.refreshTokenEnc, config.tokenKey),
      );
    } catch {
      throw new SendError(
        `${PROVIDER_NAME[provider]} access ended. Reconnect it to keep sending.`,
        409,
      );
    }
    store.updateAccessToken(
      userId,
      provider,
      encryptSecret(fresh.accessToken, config.tokenKey),
      fresh.expiresAt,
      fresh.refreshToken ? encryptSecret(fresh.refreshToken, config.tokenKey) : null,
    );
    return fresh.accessToken;
  }

  async function sendInvoice(user: User, provider: Provider, mail: OutgoingMail) {
    const connection = store.connection(user.id, provider);
    if (!connection) throw new SendError(`${PROVIDER_NAME[provider]} is not connected.`, 409);
    if (!isEmail(mail.to)) throw new SendError('Enter a valid recipient email address.', 400);
    if (!mail.subject.trim()) throw new SendError('Enter a subject.', 400);
    if (!mail.text.trim()) throw new SendError('Enter a message.', 400);
    let result;
    try {
      result = await sendOnce(
        provider,
        fetchImpl,
        await accessToken(user.id, provider, false),
        mail,
        connection.email,
      );
    } catch (error) {
      // 401 means the token was refused before anything was sent, so one retry is safe.
      if (!(error instanceof SendError) || error.status !== 401) throw error;
      result = await sendOnce(
        provider,
        fetchImpl,
        await accessToken(user.id, provider, true),
        mail,
        connection.email,
      );
    }
    store.logSent(user.id, provider, mail.to, mail.subject, result.providerMessageId);
    return result;
  }

  // Routes

  async function signUp(req: IncomingMessage, res: ServerResponse) {
    const form = await readForm(req);
    const values = {
      fullName: field(form, 'fullName', 120),
      username: field(form, 'username', 64),
      email: field(form, 'email').toLowerCase(),
      phone: field(form, 'phone', 40),
      company: field(form, 'company', 120),
    };
    const password = form.get('password') ?? '';
    const fail = (error: string) => sendHtml(res, 400, signUpPage({ setup, values, error }));
    if (!values.fullName) return fail('Enter your full name.');
    if (!USERNAME_RE.test(values.username)) {
      return fail('Use 3 to 32 letters, numbers, dots, dashes or underscores for the username.');
    }
    if (!isEmail(values.email)) return fail('Enter a valid email address.');
    if (!PHONE_RE.test(values.phone))
      return fail('Use only numbers and + ( ) - . in the phone number.');
    const problem = passwordProblem(password, values.username);
    if (problem) return fail(problem);
    if (password !== (form.get('confirm') ?? '')) return fail('The two passwords do not match.');
    if (store.usernameTaken(values.username)) return fail('That username is taken. Pick another.');
    if (store.emailTaken(values.email)) {
      return fail('An account with that email already exists. Sign in instead.');
    }
    let user: User;
    try {
      user = store.createUser({ ...values, passwordHash: await hashPassword(password, cost) });
    } catch {
      return fail('That username or email is already in use.');
    }
    startSession(res, req, user.id, form.get('remember') === '1');
    redirect(res, '/account?notice=welcome');
  }

  async function signIn(req: IncomingMessage, res: ServerResponse) {
    const form = await readForm(req);
    const login = field(form, 'login').toLowerCase();
    const password = form.get('password') ?? '';
    const address = req.socket.remoteAddress ?? 'unknown';
    const minutes = limiter.blockedFor(login, address);
    if (minutes > 0) {
      return sendHtml(
        res,
        429,
        signInPage({
          setup,
          login,
          error: `Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        }),
      );
    }
    const user = login ? store.userByUsernameOrEmail(login) : null;
    const ok = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, await dummyPasswordHash(cost)), false);
    if (!user || !ok) {
      limiter.fail(login, address);
      return sendHtml(res, 401, signInPage({ setup, login, error: 'Wrong username or password.' }));
    }
    limiter.reset(login);
    startSession(res, req, user.id, form.get('remember') === '1');
    redirect(res, '/account');
  }

  function oauthStart(req: IncomingMessage, res: ServerResponse, url: URL, provider: Provider) {
    if (!clientFor(provider, config)) {
      return sendHtml(
        res,
        404,
        errorPage(404, `${PROVIDER_NAME[provider]} is not set up on this server yet.`),
      );
    }
    const purpose =
      url.searchParams.get('purpose') === 'connect' ? 'connect' : ('signin' as OAuthPurpose);
    const session = currentSession(req);
    if (purpose === 'connect' && !session) return redirect(res, '/signin');
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    const binding = randomToken();
    store.saveOAuthState(sha256(state), {
      bindingHash: sha256(binding),
      provider,
      purpose,
      codeVerifier: verifier,
      nonce,
      userId: session?.user.id ?? null,
      expiresAt: Date.now() + OAUTH_STATE_MS,
    });
    appendCookie(
      res,
      serializeCookie(oauthCookie, binding, {
        secure: config.secureCookies,
        maxAgeSeconds: OAUTH_STATE_MS / 1000,
      }),
    );
    redirect(
      res,
      authorizeUrl(provider, purpose, config, {
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
        loginHint: purpose === 'connect' ? session?.user.email : undefined,
      }),
      302,
    );
  }

  async function oauthCallback(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    provider: Provider,
  ) {
    const stateParam = url.searchParams.get('state') ?? '';
    const binding = parseCookies(req.headers.cookie)[oauthCookie] ?? '';
    clearCookie(res, oauthCookie);
    const state = stateParam ? store.takeOAuthState(sha256(stateParam)) : null;
    if (
      !state ||
      state.provider !== provider ||
      state.expiresAt < Date.now() ||
      !binding ||
      state.bindingHash !== sha256(binding)
    ) {
      return sendHtml(
        res,
        400,
        signInPage({
          setup,
          error: 'That sign-in link expired or was not started here. Try again.',
        }),
      );
    }
    const session = currentSession(req);
    const back = state.purpose === 'connect' || state.userId ? '/account' : '/signin';
    if (url.searchParams.get('error')) return redirect(res, `${back}?notice=cancelled`);
    const code = url.searchParams.get('code');
    if (!code) return sendHtml(res, 400, errorPage(400, 'The provider did not return a code.'));
    if (state.userId !== null && session?.user.id !== state.userId) {
      return sendHtml(
        res,
        403,
        signInPage({ setup, error: 'Your session changed during sign-in. Sign in and try again.' }),
      );
    }

    let tokens;
    let claims;
    try {
      tokens = await exchangeCode(provider, config, fetchImpl, code, state.codeVerifier);
      if (!tokens.idToken) throw new Error('no id_token');
      claims = verifyIdToken(provider, config, tokens.idToken, state.nonce);
    } catch {
      return sendHtml(
        res,
        502,
        errorPage(502, `${PROVIDER_NAME[provider]} sign-in could not be completed. Try again.`),
      );
    }

    if (state.purpose === 'connect') {
      const user = session!.user;
      const scopes = tokens.scope.toLowerCase().split(/\s+/);
      const canSend =
        provider === 'google' ? scopes.includes(GMAIL_SEND_SCOPE) : scopes.includes('mail.send');
      if (!canSend) {
        return sendHtml(
          res,
          400,
          renderAccount(user, {
            error: `${PROVIDER_NAME[provider]} did not allow sending email. Connect again and allow sending.`,
          }),
        );
      }
      let mailbox = claims.email;
      if (provider === 'microsoft') {
        mailbox =
          (await microsoftMailbox(fetchImpl, tokens.accessToken).catch(() => '')) || claims.email;
      }
      if (!isEmail(mailbox)) {
        return sendHtml(
          res,
          502,
          renderAccount(user, { error: 'The mailbox address could not be read.' }),
        );
      }
      store.saveConnection({
        userId: user.id,
        provider,
        email: mailbox.toLowerCase(),
        refreshTokenEnc: tokens.refreshToken
          ? encryptSecret(tokens.refreshToken, config.tokenKey)
          : null,
        accessTokenEnc: encryptSecret(tokens.accessToken, config.tokenKey),
        accessExpiresAt: tokens.expiresAt,
      });
      return redirect(res, `/account?notice=connected_${provider}`);
    }

    // Sign-in, or linking a sign-in to the account that started it.
    const owner = store.identity(provider, claims.subject);
    if (state.userId !== null) {
      if (owner !== null && owner !== state.userId) {
        return sendHtml(
          res,
          409,
          renderAccount(session!.user, {
            error: 'That sign-in already belongs to another account.',
          }),
        );
      }
      store.linkIdentity(provider, claims.subject, state.userId, claims.email);
      return redirect(res, '/account?notice=linked');
    }
    if (owner !== null) {
      startSession(res, req, owner, true);
      return redirect(res, '/account');
    }
    const email = claims.email.toLowerCase();
    if (!isEmail(email)) {
      return sendHtml(
        res,
        400,
        signInPage({ setup, error: `${PROVIDER_NAME[provider]} did not share an email address.` }),
      );
    }
    const existing = store.userByEmail(email);
    if (existing) {
      if (!claims.emailVerified) {
        return sendHtml(
          res,
          409,
          signInPage({
            setup,
            login: email,
            error:
              'An account with this email already exists. Sign in with your username and password, then link this sign-in from your account page.',
          }),
        );
      }
      store.linkIdentity(provider, claims.subject, existing.id, email);
      startSession(res, req, existing.id, true);
      return redirect(res, '/account');
    }
    const user = store.createUser({
      username: suggestUsername(email, (u) => store.usernameTaken(u)),
      email,
      passwordHash: null,
      fullName: claims.name.slice(0, 120),
      phone: '',
      company: '',
    });
    store.linkIdentity(provider, claims.subject, user.id, email);
    startSession(res, req, user.id, true);
    redirect(res, '/account?notice=welcome');
  }

  async function updateProfile(req: IncomingMessage, res: ServerResponse, user: User) {
    const form = await readForm(req);
    const profile = {
      fullName: field(form, 'fullName', 120),
      email: field(form, 'email').toLowerCase(),
      phone: field(form, 'phone', 40),
      company: field(form, 'company', 120),
    };
    const fail = (error: string) =>
      sendHtml(res, 400, renderAccount({ ...user, ...profile }, { error }));
    if (!isEmail(profile.email)) return fail('Enter a valid email address.');
    if (!PHONE_RE.test(profile.phone))
      return fail('Use only numbers and + ( ) - . in the phone number.');
    if (store.emailTaken(profile.email, user.id))
      return fail('Another account already uses that email.');
    store.updateProfile(user.id, profile);
    redirect(res, '/account?notice=saved');
  }

  async function changePassword(
    req: IncomingMessage,
    res: ServerResponse,
    user: User,
    idHash: string,
  ) {
    const form = await readForm(req);
    const password = form.get('password') ?? '';
    const fail = (error: string) => sendHtml(res, 400, renderAccount(user, { error }));
    if (
      user.passwordHash &&
      !(await verifyPassword(form.get('current') ?? '', user.passwordHash))
    ) {
      return fail('The current password is wrong.');
    }
    const problem = passwordProblem(password, user.username);
    if (problem) return fail(problem);
    if (password !== (form.get('confirm') ?? ''))
      return fail('The two new passwords do not match.');
    store.setPasswordHash(user.id, await hashPassword(password, cost));
    store.deleteOtherSessions(user.id, idHash);
    redirect(res, '/account?notice=password');
  }

  async function sendFromForm(req: IncomingMessage, res: ServerResponse, user: User) {
    const form = await readForm(req);
    const provider: Provider = form.get('provider') === 'microsoft' ? 'microsoft' : 'google';
    try {
      await sendInvoice(user, provider, {
        to: field(form, 'to'),
        subject: field(form, 'subject', 200),
        text: (form.get('text') ?? '').slice(0, 20_000),
      });
    } catch (error) {
      if (error instanceof SendError) {
        return sendHtml(
          res,
          error.status >= 500 ? 502 : 400,
          renderAccount(user, { error: error.message }),
        );
      }
      throw error;
    }
    redirect(res, '/account?notice=sent');
  }

  async function sendFromApi(req: IncomingMessage, res: ServerResponse, user: User) {
    const body = await readJson(req);
    const requested =
      body.provider === 'microsoft' || body.provider === 'google' ? body.provider : null;
    const provider = requested ?? store.connections(user.id)[0]?.provider;
    if (!provider) return sendJson(res, 409, { error: 'Connect Gmail or Outlook first.' });
    try {
      const result = await sendInvoice(user, provider, {
        to: typeof body.to === 'string' ? body.to.trim() : '',
        subject: typeof body.subject === 'string' ? body.subject.slice(0, 200) : '',
        text: typeof body.text === 'string' ? body.text.slice(0, 20_000) : '',
      });
      sendJson(res, 200, { sent: true, provider, providerMessageId: result.providerMessageId });
    } catch (error) {
      if (error instanceof SendError)
        return sendJson(res, error.status >= 500 ? 502 : error.status, { error: error.message });
      throw error;
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', config.publicUrl);
    const path = url.pathname;

    if (!allowedHosts.has(req.headers.host ?? '')) throw new HttpError(421, 'Unknown host.');
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      throw new HttpError(403, 'Requests from other sites are not allowed.');
    }

    if (method === 'GET' && path === '/app.css') {
      res.setHeader('cache-control', 'public, max-age=3600');
      res.setHeader('content-type', 'text/css; charset=utf-8');
      return void res.end(CSS);
    }
    if (method === 'GET' && path === '/healthz') return sendJson(res, 200, { ok: true });
    if (method === 'GET' && path === '/favicon.ico') {
      res.statusCode = 204;
      return void res.end();
    }

    const oauth = /^\/auth\/(gmail|outlook)\/(start|callback)$/.exec(path);
    if (oauth && method === 'GET') {
      const provider = PATH_PROVIDER[oauth[1]!]!;
      return oauth[2] === 'start'
        ? oauthStart(req, res, url, provider)
        : oauthCallback(req, res, url, provider);
    }

    const session = currentSession(req);

    if (method === 'GET' && path === '/') return redirect(res, session ? '/account' : '/signin');
    if (path === '/signin') {
      if (method === 'GET') {
        if (session) return redirect(res, '/account');
        return sendHtml(res, 200, signInPage({ setup, notice: noticeFrom(url) }));
      }
      if (method === 'POST') return signIn(req, res);
    }
    if (path === '/signup') {
      if (method === 'GET')
        return session ? redirect(res, '/account') : sendHtml(res, 200, signUpPage({ setup }));
      if (method === 'POST') return signUp(req, res);
    }
    if (method === 'POST' && path === '/signout') {
      if (session) store.deleteSession(session.idHash);
      clearCookie(res, sessionCookie);
      return redirect(res, '/signin?notice=signed_out');
    }

    if (path.startsWith('/api/')) {
      if (!session) throw new HttpError(401, 'Sign in first.');
      if (method === 'GET' && path === '/api/me') {
        const { user } = session;
        return sendJson(res, 200, {
          user: {
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            company: user.company,
          },
          connections: store
            .connections(user.id)
            .map((c) => ({ provider: c.provider, email: c.email })),
        });
      }
      if (method === 'POST' && path === '/api/invoices/send')
        return sendFromApi(req, res, session.user);
      throw new HttpError(404, 'Not found.');
    }

    if (path === '/account' || path.startsWith('/account/')) {
      if (!session) {
        if (method === 'GET') return redirect(res, '/signin');
        throw new HttpError(401, 'Sign in first.');
      }
      const { user, idHash } = session;
      if (method === 'GET' && path === '/account')
        return sendHtml(res, 200, renderAccount(user, { notice: noticeFrom(url) }));
      if (method === 'POST' && path === '/account/profile') return updateProfile(req, res, user);
      if (method === 'POST' && path === '/account/password')
        return changePassword(req, res, user, idHash);
      if (method === 'POST' && path === '/account/send') return sendFromForm(req, res, user);
      const disconnect = /^\/account\/mail\/(gmail|outlook)\/disconnect$/.exec(path);
      if (method === 'POST' && disconnect) {
        store.deleteConnection(user.id, PATH_PROVIDER[disconnect[1]!]!);
        return redirect(res, '/account?notice=disconnected');
      }
    }
    throw new HttpError(404, 'Page not found.');
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    securityHeaders(res);
    try {
      await route(req, res);
    } catch (error) {
      if (res.headersSent) return void res.end();
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError ? error.message : 'The server hit an unexpected error.';
      if (status === 500)
        console.error(
          '[mail-connect] request failed:',
          error instanceof Error ? error.message : error,
        );
      if ((req.url ?? '').startsWith('/api/')) sendJson(res, status, { error: message });
      else sendHtml(res, status, errorPage(status, message));
    }
  };
}
