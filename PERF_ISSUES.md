# Performance review

The following opportunities are based on the current API implementation. Impact and effort are relative estimates, not benchmark results; priority is impact divided by effort. Existing database indexes are already present in `database.js` and are not listed as outstanding work.

| Rank | Improvement | Impact / effort (score) | Location |
| --- | --- | --- | --- |
| 1 | Replace the nested product-search loops with a single filter pass and normalize the query once. | 9 / 1 (9.00) | `server.js`, `/api/products/search` |
| 2 | Paginate log retrieval instead of reading the entire log table into memory for each request. | 8 / 2 (4.00) | `server.js`, `/api/logs` |
| 3 | Use asynchronous file I/O for the order export to avoid blocking the Node.js event loop. | 8 / 2 (4.00) | `server.js`, `/api/export/orders` |
| 4 | Remove the threefold product duplication in bulk responses; enable compression if large payloads remain necessary. | 7 / 2 (3.50) | `server.js`, `/api/bulk-data` |
| 5 | Add bounded subscription lifetimes and cleanup so retained callbacks do not grow indefinitely. | 6 / 2 (3.00) | `server.js`, `/api/orders/:orderId/subscribe` |
| 6 | Replace the nested-quantifier email regex with a bounded-time validator to avoid expensive matching on long inputs. | 6 / 2 (3.00) | `server.js`, `/api/validate/email` |
| 7 | Cap order page size and add pagination so clients cannot request arbitrarily large result sets. | 8 / 3 (2.67) | `server.js`, `/api/orders` |
| 8 | Aggregate category counts and prices in SQL rather than loading up to 10,000 rows and iterating in JavaScript. | 7 / 3 (2.33) | `server.js`, `/api/stats/category/:category` |
| 9 | Seed sample data in a transaction with prepared/batched inserts to reduce startup database work. | 6 / 3 (2.00) | `database.js`, `seedDatabase` |
| 10 | Replace per-order user and item lookups with joined/batched queries; handle each query error. | 9 / 5 (1.80) | `server.js`, `/api/orders` |

## Selected improvement

The product search route was the highest-impact, lowest-effort change. Its nested loop visited every product once for every product, making the in-memory work O(n²); it now filters once in O(n), preserving the original case-insensitive substring matching and result order. This change does not remove the separate cost of loading all products from SQLite; SQL-side search and pagination can be considered separately.
