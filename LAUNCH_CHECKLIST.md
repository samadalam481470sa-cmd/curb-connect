# Launch Checklist — Curb Connect

**Status:** Ready for production. Email verification works. Sign-in flows pass all tests.

## Before Going Live

- [ ] **Make GitHub repo private**
  - URL: https://github.com/samadalam481470sa-cmd/curb-connect/settings
  - Scroll to "Danger Zone" > "Repository visibility" > "Make private"
  - See `docs/deploy-production.md` for detailed steps

- [ ] **Set SMTP_URL in Render**
  - Service: **curb-connect-api**
  - Environment: add `SMTP_URL` (see `docs/deploy-production.md` for Gmail, SendGrid, AWS SES examples)
  - Example for Gmail: `smtps://your.email@gmail.com:APP_PASSWORD@smtp.gmail.com:465`
  - Requires: [Google App Password](https://support.google.com/accounts/answer/185833) if using Gmail

- [ ] **Configure OAuth providers (optional)**
  - Microsoft: Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
  - Google: Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Both in Render **curb-connect-api** Environment tab

- [ ] **Redeploy after changes**
  - Push latest main to Render
  - Wait for build and health checks to pass (~3 min)

## Verify After Deploy

- [ ] Sign up with a new password account
- [ ] Check email inbox for verification link
- [ ] Open the link and confirm email
- [ ] Verify trial starts (7 days)
- [ ] Create a company and reach the dashboard
- [ ] Sign out and sign back in with the same credentials

## What's Included

✅ **Sign-in methods:**
- Username/password with email verification
- Microsoft OAuth (when configured)
- Google OAuth (when configured)
- Dev IdP (development only)

✅ **Account & Trial:**
- 7-day free trial per company
- One trial per normalized email address
- Trial can be extended with activation codes
- Paid subscriptions via Stripe (configure STRIPE_PRICE_ID and keys separately)

✅ **Account verification:**
- Password accounts get a 48-hour verification link via email
- Auto-verified if SMTP_URL is not set (users not locked out)
- Microsoft/Google users verified by their provider

✅ **Roofing features:**
- Curb measurement and roofing takeoff (home-builder module)
- Roof damage photo analysis with AI (vision module)
- Pricing and cost calculation

✅ **Data:**
- US building footprints (limited states, see legal/data-sources)
- Roof material pricing and availability

## Monitoring

Watch Render logs for:
- SMTP connection errors (email not sending)
- 402 trial_expired responses (trial enforcement working)
- Password hashing or session errors (security)

See `docs/deploy-production.md` for full troubleshooting guide.

## Code Status

- Main branch: **production-ready**
- All tests passing (unit, integration, e2e browser)
- Lint and typecheck clean
- Secret scan: no credentials in repo
- Last commit: auto-verified sign-up + deployment guide

## Next Steps (After Launch)

- [ ] Monitor user sign-ups and trial starts
- [ ] Set up Stripe billing (requires STRIPE_SECRET_KEY, STRIPE_PRICE_ID)
- [ ] Add online cancellation UI (legal requirement before Stripe launch)
- [ ] Email reminders before trial ends (nice-to-have)
- [ ] Wider device testing for the iOS app (AR measurement)
