# Performance review

These are source-based opportunities for the current Fortday storefront. Impact/effort scores are relative estimates (1-10), not benchmark results; priority is impact divided by effort.

| Rank | Improvement | Impact / effort (score) | Location |
| --- | --- | --- | --- |
| 1 | Index the active catalog in its filter and sort order to avoid scanning/sorting the whole catalog as it grows. | 8 / 1 (8.00) | `database.js`, `listProducts` |
| 2 | Add short-lived caching or conditional responses for the mostly static product catalog. | 6 / 2 (3.00) | `server.js`, `GET /api/products` |
| 3 | Remove the unused customer-email index; current order reads start from primary-key order IDs or unique Stripe session IDs. | 3 / 1 (3.00) | `database.js`, `store_orders` |
| 4 | Compress larger JSON responses, particularly the catalog once it grows. | 5 / 2 (2.50) | `server.js` |
| 5 | Cache static assets for a bounded period; use fingerprinted filenames before using long-lived immutable caching. | 5 / 2 (2.50) | `server.js`, `public/` |
| 6 | Paginate the product catalog and render incrementally if the catalog grows beyond a small set. | 7 / 3 (2.33) | `database.js`, `/api/products`, `public/app.js` |
| 7 | Batch seed inserts in a transaction to reduce startup round trips when the sample catalog grows. | 4 / 2 (2.00) | `database.js`, `initializeDatabase` |
| 8 | Avoid loading configuration and catalog through separate page-load requests if the storefront API contract is expanded. | 3 / 2 (1.50) | `public/app.js`, `/api/config`, `/api/products` |
| 9 | Add a SQLite busy timeout and measure write contention before considering a different persistence layer. | 4 / 3 (1.33) | `database.js`, `openDatabase` |
| 10 | Persist email/CRM delivery jobs and acknowledge Stripe webhooks after durable fulfillment, rather than waiting on external services. | 8 / 7 (1.14) | `server.js`, Stripe webhook |

## Selected improvement

The catalog query filters on `active` and orders by `category, name`. A composite index on `(active, category, name)` matches that access pattern and is created idempotently during database initialization. It is the best low-effort query improvement found; its benefit scales with catalog size and should be confirmed with representative data before claiming a speedup.
