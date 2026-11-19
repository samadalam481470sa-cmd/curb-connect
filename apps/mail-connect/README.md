# Curb Connect Mail (`apps/mail-connect`)

A small local server that sends invoice emails from each user's own Gmail or Outlook account. It
has its own accounts: people create an account with a username and password, or sign in with
Google or Microsoft.

It runs on `http://localhost:4500` and uses only Node built-ins (`node:http`, `node:crypto`,
`node:sqlite`). There are no extra runtime packages.

## What it does

- **Create account.** Full name, username, email, phone (optional), company (optional) and a
  password. The details are saved in a SQLite database.
- **Sign in** with a username or email and password. "Keep me signed in" keeps the session for 30
  days. Without it, the session ends when the browser closes (or after 12 hours).
- **Sign in with Google (Gmail) or Microsoft (Outlook)** with the buttons at the bottom of the sign-in
  and create-account pages. The first time, this creates an account from the provider's name and
  email.
- **Account page.** Edit your information, change or set a password, link Google or Microsoft
  sign-in, connect Gmail or Outlook for sending, send an invoice email, and see recent sends.
- **JSON API** for other Curb Connect parts: `GET /api/me` and `POST /api/invoices/send` with
  `{ "provider": "google" | "microsoft", "to", "subject", "text" }`.

## How passwords are kept

The server never stores a password. It stores a salted scrypt hash (`N=32768, r=8, p=1`), which
cannot be turned back into the password. At sign-in, the typed password is hashed the same way and
compared. The browser's own password manager can also save the username and password, because
the forms use the standard `autocomplete` fields.

## Setup

1. In Google Cloud, create a **Web** OAuth client with the redirect URI
   `http://localhost:4500/auth/gmail/callback`, and enable the Gmail API. While the consent screen
   is in Testing, add each Google account that will use it as a test user.
2. In Microsoft Entra, register an app with the **Web** redirect URI
   `http://localhost:4500/auth/outlook/callback` and the delegated permissions `openid`, `email`,
   `profile`, `offline_access`, `User.Read` and `Mail.Send`. Create a client secret.
3. Copy `.env.example` to `.env` and fill in your own client IDs, secrets and a
   `TOKEN_ENCRYPTION_KEY`. Do not reuse keys from other apps. Make the key with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Start it from the repository root:

   ```sh
   npm run dev:mail
   ```

   Then open http://localhost:4500.

Google or Microsoft can be left blank. Its button then shows "not set up yet", and username and
password sign-in still works.

## Security

- Sessions are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie. Only a SHA-256 of
  the token is stored. Signing in replaces the old session. Changing the password signs out every
  other device.
- Five wrong passwords for one username block that username for 15 minutes. A wrong username and
  a wrong password give the same message and take the same time.
- Gmail and Outlook access and refresh tokens are encrypted with AES-256-GCM using
  `TOKEN_ENCRYPTION_KEY` before they reach the database.
- Google and Microsoft sign-in use the authorization code flow with PKCE, a one-time `state` tied to
  the browser by a cookie, and a `nonce`. The ID token's issuer, audience, expiry and nonce are
  checked.
- A Microsoft email is never used to join an existing account, because Microsoft does not promise
  it is verified. A verified Google email is.
- Every POST must come from this server's own pages (Origin and Fetch Metadata checks). JSON routes
  also require `Content-Type: application/json`. Requests for other host names are refused, which
  blocks DNS-rebinding attacks.
- Pages carry a strict Content-Security-Policy with no scripts, `frame-ancestors 'none'` and
  `Referrer-Policy: same-origin`.

## Limits

- It binds to `127.0.0.1` by default. To use it from other devices, put it behind HTTPS and set
  `PUBLIC_URL` to the HTTPS address. Cookies then get the `Secure` flag and the `__Host-` prefix.
- There is no email verification or "forgot password" email yet. A user who forgets a password and
  has no linked Google or Microsoft sign-in needs a new account.
- Sending a message is not retried after a provider error other than an expired token, because the
  message may already have gone out.
- `node:sqlite` prints an "experimental" warning on start. It is safe to ignore.

## Tests

```sh
npm run test:unit -w @fieldline/mail-connect
```

The tests start a real server on a random port and replace Google, Microsoft, Gmail and Graph with
an in-memory fake, so they need no network.
