# GDP Clinic guide checkout

The original supplied HTML is preserved. The updated app is in `public/` with
Paystack redirect checkout, server-side payment verification, a purchase library,
and a protected module reader. Telehealth keeps the original booking flow.

## Run locally

Use Node 22.20 or newer. Run `npm install`, copy `.env.example` to `.env`, then
`npm start`. Open http://localhost:3000/#/guides. `npm test` uses mock payments
and temporary content: it never charges money or calls Paystack.

Add a Paystack **test** secret key to `.env` and add the actual approved guide
content following `content/README.md`. Until these are supplied the app cannot
take payments. Never put secret keys in `public/` or commit `.env`.

## Vercel and subdomain

1. Import this folder as a separate Vercel project. Use framework preset Other;
   `vercel.json` defines the build, public output and API routing.
2. Connect a Neon Postgres database using Vercel Marketplace. Set `DATABASE_URL`
   to its connection string. The app creates its tables on the first API call.
   Vercel deployments require Postgres; SQLite is for local development only.
3. Set `PUBLIC_URL` to the exact HTTPS origin of this app, e.g.
   `https://guides.gdpclinic.com` (example only; confirm the actual domain).
   Add `PAYSTACK_SECRET_KEY` as a server environment variable. Start with a test key.
4. Add this subdomain under the new project's Domains settings. Apply the exact
   DNS record Vercel supplies. This does not require moving the main website.
5. Add the real six-module JSON files under `content/` and deploy. Test payment,
   return, unlock, failed payment, refresh, and reading each module on the deployed
   origin. For preview domains, set PUBLIC_URL to that preview origin, too.
6. After the client validates the test checkout, switch to the live Paystack key.

This workspace has not been deployed and contains no client credentials or actual
book bodies. No real gateway transaction or hosted Postgres connection was tested.

## Payment and access behavior

Amounts are authoritative in `catalog.json`, stored in kobo and never accepted
from the browser. Callback URL parameters alone cannot unlock a book. Verification
checks Paystack status, reference, exact amount, currency and customer email.
Each order is bound to a random HttpOnly browser cookie, stored hashed in the DB.
Only that browser session can verify/read it. Paid access survives restarts and
redeployments with Postgres. Content is never placed in the public asset directory.

Payment is checked automatically on return from Paystack. If the customer closes
the tab before returning, My guides → Check payment verifies the pending order.
Checks are idempotent. This version uses callback/manual verification; it does not
include a webhook or email-based sign-in. Access lasts up to one year in the same
browser. Clearing cookies or moving devices requires clinic support; add account
or email-link recovery before promising cross-device or lifetime access.

The local rate limiter is a basic per-process safeguard. Use Vercel Firewall rate
limits for production abuse controls across function instances. The database
contains purchase emails; restrict its access and set client retention policies.

To change prices, update `catalog.json` and the corresponding storefront product
prices in `public/index.html` together. Existing orders keep their original amount.
`prepare.mjs` rebuilds the public HTML and catalogue from the untouched original;
only rerun it intentionally, as it overwrites those two files.
