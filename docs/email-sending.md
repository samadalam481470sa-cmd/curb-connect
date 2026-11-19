# Email sending from Gmail and Outlook

Field Pro can email an invoice from a member's own Gmail or Outlook address. The PDF is attached, and the message lands in that member's Sent folder.

## How it works

There are three parts.

- **The mail server** is `apps/mailer`, port 4300. It is a separate process with its own settings and its own Google and Microsoft app keys. It runs the Google and Microsoft sign-in, keeps each member's refresh token encrypted (AES-256-GCM), and sends the messages.
- **The API** (`apps/api`) never sees a Google or Microsoft token. It signs short requests for the signed-in member and passes the answers to the web app. It stores only the outcome on the invoice: queued, sent, failed or unknown.
- **The web app** has two screens. **Settings → Email** connects Gmail or Outlook. **Billing** has an "Email to" field and a "Send automatically when created" box on the invoice form.

What happens when you create an invoice with an email address and auto-send ticked:

1. The API creates the invoice, issues it to the connected company, and queues an `invoice.email` job in the same transaction.
2. The worker renders the invoice PDF and asks the mail server to send it from the member's chosen mailbox (or their default one).
3. The mail server refreshes the Google or Microsoft access token and sends through the Gmail API or Microsoft Graph `sendMail`.
4. Billing shows the result in the Email column.

Each attempt has its own idempotency key, so a retried job never sends a second copy. A send that stopped mid-way is marked "Check Sent folder" and is never resent automatically. "Email again" sends a new copy only when a person chooses it.

Permissions requested:

- Google: `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.send`. Google classifies `gmail.send` as a sensitive scope. It can send mail, but it cannot read the inbox.
- Microsoft: `openid`, `email`, `profile`, `offline_access`, `User.Read` and `Mail.Send` (delegated). It can send mail as the member, but it cannot read mail.

The app keys are new and belong to the mail server only. Do not reuse the Newport CRM's client IDs or secrets. Do not reuse the API's own sign-in keys (`GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`) either.

## 1. Generate the two random secrets

```sh
npm run keys -w @fieldline/mailer
```

This prints `MAILER_SHARED_SECRET` and `MAILER_TOKEN_ENCRYPTION_KEY`. The shared secret goes in both `apps/mailer/.env.local` and `apps/api/.env.local`. The encryption key goes only in `apps/mailer/.env.local`. If you change or lose the encryption key, every member has to connect their mailbox again.

## 2. Create the Google OAuth client (Gmail)

1. Open https://console.cloud.google.com and create a project named "Field Pro Mail", or pick an existing project that is not Newport's.
2. Go to APIs & Services → Library, search for "Gmail API", and click Enable.
3. Go to Google Auth Platform → Branding (or "OAuth consent screen"). Choose External and fill in the app name, support email and developer email.
4. Go to Data Access and add the scope `https://www.googleapis.com/auth/gmail.send`.
5. Go to Audience. While the app is in Testing, add every Google account that will connect, such as your own Gmail. Testing allows up to 100 test users.
6. Go to Clients → Create client. Choose type "Web application" and name it "Field Pro mail server".
7. Under Authorized redirect URIs, add `http://localhost:4300/oauth/gmail/callback`. For Render, also add `https://curb-connect-mailer.onrender.com/oauth/gmail/callback`.
8. Click Create. Copy the Client ID into `GOOGLE_MAIL_CLIENT_ID` and the Client secret into `GOOGLE_MAIL_CLIENT_SECRET`.

In Testing, Google expires refresh tokens 7 days after consent. After that, Settings → Email asks the member to reconnect. To avoid this, publish the app (Audience → Publish app). Publishing an app that uses a sensitive scope needs Google's verification before people outside your test list see a normal consent screen.

## 3. Create the Microsoft app registration (Outlook)

1. Open https://entra.microsoft.com and go to Identity → Applications → App registrations → New registration. Your Azure for Students account works for this.
2. Name it "Field Pro mail server".
3. For Supported account types, choose "Accounts in any organizational directory and personal Microsoft accounts". This allows work, school, Outlook.com and Hotmail accounts.
4. For Redirect URI, choose platform "Web" and enter `http://localhost:4300/oauth/outlook/callback`. Click Register.
5. On the app's Authentication page, add `https://curb-connect-mailer.onrender.com/oauth/outlook/callback` as a second Web redirect URI for Render.
6. On API permissions, click Add a permission → Microsoft Graph → Delegated permissions. Add `Mail.Send`, `User.Read`, `offline_access`, `openid`, `email` and `profile`. None of these needs admin consent.
7. On Certificates & secrets, click New client secret. Copy the **Value** right away, because Azure shows it only once. It goes in `MICROSOFT_MAIL_CLIENT_SECRET`.
8. Copy the Application (client) ID from Overview into `MICROSOFT_MAIL_CLIENT_ID`. Leave `MICROSOFT_MAIL_TENANT=common`.

Client secrets expire. Azure offers 6 to 24 months. Make a new one before the old one expires.

## 4. Fill in the settings

```sh
cp apps/mailer/.env.example apps/mailer/.env.local
```

Put the values from steps 1 to 3 into `apps/mailer/.env.local`. In `apps/api/.env.local`, set:

```
MAILER_URL=http://localhost:4300
MAILER_PUBLIC_ORIGIN=http://localhost:4300
MAILER_SHARED_SECRET=<same value as the mail server>
```

`.env.local` files are git-ignored. Never commit them.

## 5. Migrate and run

```sh
npm run db:migrate   # adds the invoice email columns and allows the invoice.email job
npm run dev          # now also starts the mail server on port 4300
```

On your machine, the mail server keeps connections in `apps/mailer/.data/mailboxes.json`. The refresh tokens inside that file are encrypted. When `MAILER_DATABASE_URL` is set, it uses PostgreSQL instead, with tables in the `mailer` schema. The API's restricted database role cannot read that schema.

## 6. Use it

1. Open http://localhost:3000/settings/email and click Connect Gmail or Connect Outlook. The Google or Microsoft page opens in the same tab. After you approve, it returns to Settings → Email, and the page finishes the connection with your Field Pro sign-in. If someone else opens your connect link, their mailbox is not attached to your account.
2. If you connect both, choose which one invoices are sent from.
3. In Billing, fill in the invoice and type an address in "Email to". Leave "Send automatically when created" ticked and click "Create, send and email invoice".
4. The Email column shows Queued, then Emailed with the sending address. If it shows Not sent, the reason is shown under it. Fix the cause and click Email again.

## Render

`render.yaml` defines `curb-connect-mailer` next to the API and the web app. Render generates `MAILER_SHARED_SECRET` once and shares it with the API. Enter these in the Render dashboard: `MAILER_TOKEN_ENCRYPTION_KEY`, `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET`, `MICROSOFT_MAIL_CLIENT_ID` and `MICROSOFT_MAIL_CLIENT_SECRET`.

On the free plan, the mail server sleeps when idle. The first request wakes it in about a minute. During that time Settings → Email may show the feature as unavailable, and queued emails wait and retry.

## Messages on Settings → Email

| Message | Cause |
| --- | --- |
| Sign-in was cancelled | You clicked Cancel on the Google or Microsoft page. |
| "send email on your behalf" was unticked | Google lets people untick single permissions. Connect again and leave it ticked. |
| Not set up on the mail server yet | That provider's client ID and secret are missing from the mail server settings. |
| That sign-in link expired | More than 10 minutes passed, or the link was opened twice. Start again. |
| started from a different Field Pro account | The connect link was opened while signed in as someone else. Sign in as yourself and connect again. |
| needs to be reconnected (on an invoice) | The grant was revoked, the password changed, or a Testing-mode Google token reached 7 days. |
