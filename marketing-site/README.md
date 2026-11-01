# Field Pro marketing website

Public purchase site for the **$150 one-time Field Pro license**.

Live URL: https://field-pro-marketing.vercel.app

## What it does

1. **Purchase** — `PURCHASE FIELD PRO — $150` starts Stripe Checkout (or the hosted Payment Link fallback).
2. **Verify** — `/success.html?session_id=…` calls `/api/fulfill`, which retrieves the Checkout Session and confirms `payment_status=paid`.
3. **Download** — issues a 24-hour signed token and streams `public/releases/field-pro-app.zip` from `/api/download`.

## Stripe objects (sandbox)

| Object | Id |
| --- | --- |
| Product | `prod_VXvW41CmNLOfOP` |
| Price ($150) | `price_1UWpfV2Lo2k11Iv0f2FgrKJm` |
| Payment Link | https://buy.stripe.com/test_6oUeV6cXN0P0gzU9ss3Ru00 |

## Required environment variables (Vercel)

Copy from `.env.example`:

- `STRIPE_SECRET_KEY` — required for fulfillment / download verification
- `STRIPE_WEBHOOK_SECRET` — required for `/api/webhook`
- `DOWNLOAD_TOKEN_SECRET` — recommended (falls back to secret key)
- `STRIPE_PRICE_ID`, `STRIPE_PRODUCT_ID`, `STRIPE_PAYMENT_LINK_URL` — optional overrides

Webhook endpoint to register in Stripe:

`https://field-pro-marketing.vercel.app/api/webhook`

Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`

## Build the downloadable app zip

From the monorepo root:

```sh
npm install
node marketing-site/scripts/build-release.mjs
```

This builds `apps/field-pro-package` (real `@fieldline/pricing` engines) and writes:

- `marketing-site/public/releases/field-pro-app.zip`
- `marketing-site/public/releases/manifest.json`

## Deploy

Set the Vercel project **Root Directory** to `marketing-site`, then deploy this branch. The Payment Link works even before `STRIPE_SECRET_KEY` is set; downloads unlock after the secret key and release zip are present.
