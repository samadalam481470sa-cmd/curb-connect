# Field Pro storefront

The storefront sells the offline roof and curb calculator for a single $150 USD
payment. The download is a ZIP containing a browser app. Extract it and open
`index.html`. The hosted contractor workspace has its own sign-in and backend.

## Vercel

- Git repository: `samadalam481470sa-cmd/curb-connect`
- Production branch: `main`
- Project root: `marketing-site`
- Include source files outside the root directory. The package build uses
  `apps/field-pro-package` and the shared pricing workspace.
- Use Node 24, with the install command set to `cd .. && npm ci`.
- Use the build and output settings in `vercel.json`.

Configure `SITE_ORIGIN` (the storefront HTTPS origin), `STRIPE_SECRET_KEY`,
`STRIPE_PRICE_ID` (an active one-time $150 USD price in the same account), and a
random `DOWNLOAD_TOKEN_SECRET` of at least 32 characters. Use separate test
credentials and a preview origin for testing. Production requires a live key.

The build creates the ZIP outside the public output and includes it only with
the server functions. Checkout requires the ZIP and verifies the configured
Stripe price before creating a payment session. The confirmation and download
endpoints retrieve the Stripe session server-side. A completed, paid Field Pro
session with an eligible charge can download the package.

From the repository root after `npm ci`:

```sh
npm run build:release -w field-pro-marketing
npm test -w field-pro-marketing
```
