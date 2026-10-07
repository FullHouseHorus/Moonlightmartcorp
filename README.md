# Fortday digital storefront

A small Express and SQLite storefront for downloadable products. It includes a landing page, sample catalog and files, Stripe Checkout, signed webhook fulfillment, download links, order lookup, optional SMTP receipts, and an optional purchase webhook for a CRM or Power Automate flow.

## Run locally

Requires Node.js 18 or later.

```sh
npm install
copy .env.example .env
npm start
```

Open `http://localhost:3000`. The storefront and sample downloads work locally without Stripe, but checkout stays disabled until Stripe is configured. On Windows PowerShell, copy the environment template with `Copy-Item .env.example .env`.

## Configure Stripe test mode

1. Add your Stripe test secret key as `STRIPE_SECRET_KEY` in `.env`.
2. Set `PUBLIC_BASE_URL` to the public URL Stripe should return customers to.
3. Install and authenticate the Stripe CLI, then forward the webhook to the local server:

   ```sh
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

4. Copy the CLI's `whsec_...` signing secret to `STRIPE_WEBHOOK_SECRET`.
5. Restart the app and test with Stripe's test card `4242 4242 4242 4242`, any future expiry, and any CVC.

The webhook verifies Stripe's signature, checks the paid amount and product against the pending order, and makes fulfillment idempotent. It creates a private download token only after confirmed payment. The checkout return page polls briefly for webhook fulfillment; the same download is also sent by email when SMTP is configured.

## Products and integrations

The sample product records are inserted on first database initialization from `sampleProducts` in `database.js`; their example files are in `storefront-assets/`. To change a sample, update the seed data and corresponding file. Existing records are intentionally not overwritten on restart, so update the relevant `store_products` row in SQLite when changing an already-created local database. Product prices are integer minor units (for example, `900` is USD 9.00); store only trusted local file names in `file_name`.

To send receipts, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SUPPORT_EMAIL`. Without SMTP, customers can still download on the checkout return page and look up a paid order with its order number and checkout email. Keep the order number from the confirmation page for later lookup. Refunds are routed to the configured support address; no refund is issued automatically.

To notify a CRM or Power Automate, set `CRM_WEBHOOK_URL` to its HTTPS request-trigger URL. Each completed purchase sends a `purchase.completed` JSON event. If `CRM_WEBHOOK_SECRET` is set, `x-fortday-signature` contains the lowercase hex HMAC-SHA256 of the exact JSON request body. Non-2xx responses cause Stripe to retry delivery. The app does not create or deploy the Stripe, SMTP, CRM, Power Automate, or Copilot Studio accounts/flows; configure those services separately.

Add the public HTTPS account/profile URLs to `SOCIAL_INSTAGRAM_URL`, `SOCIAL_FACEBOOK_URL`, and `SOCIAL_TIKTOK_URL`. The storefront displays follow links only for configured profiles and includes copy-ready, platform-specific launch captions. Captions include the current storefront URL. Instagram and TikTok require you to paste the caption into your own post; their APIs do not publish from this storefront.

Set `DATABASE_PATH` to use a different SQLite file. Keep `.env`, the database, and download assets private in deployment, serve the app over HTTPS, and back up the database and product files together.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health status |
| `GET` | `/api/products` | Active catalog |
| `POST` | `/api/checkout` | Create a Stripe Checkout session (`productId`, `email`) |
| `POST` | `/api/webhooks/stripe` | Verify and process Stripe payment events |
| `GET` | `/api/orders/session/:sessionId` | Retrieve a paid checkout's confirmation |
| `POST` | `/api/support/order` | Look up an order (`orderId`, `email`) |
| `GET` | `/api/download/:token` | Download a paid product using its private token |

Run the focused application tests with `npm test`.
