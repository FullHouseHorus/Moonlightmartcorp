# Performance Issues & Anti-Patterns Analysis

## Overview
This document identifies and prioritizes 10 critical performance issues in the Moonlight Mart API. Each issue is scored on Impact (1-10) and Effort (1-10), with a calculated **Priority Score = Impact × (1/Effort)** to identify highest-impact, lowest-effort wins.

---

## Issues Ranked by Priority Score

| Rank | Issue | Impact | Effort | Priority Score | Location |
|------|-------|--------|--------|-----------------|----------|
| 1 | Missing Database Indexes | 9 | 2 | **4.50** | `database.js` |
| 2 | N+1 Database Queries | 9 | 5 | **1.80** | `server.js:30-65` |
| 3 | No Pagination on Large Result Sets | 8 | 3 | **2.67** | Multiple routes |
| 4 | No Caching Layer (Redis-like) | 7 | 4 | **1.75** | `server.js:152-184` |
| 5 | Synchronous File Operations | 6 | 2 | **3.00** | `server.js:68-85` |
| 6 | Memory Leaks (Event Listeners) | 7 | 3 | **2.33** | `server.js:130-145` |
| 7 | Uncompressed API Responses | 6 | 3 | **2.00** | `server.js:212-231` |
| 8 | Missing Connection Pooling | 5 | 4 | **1.25** | `server.js:187-210` |
| 9 | Inefficient Loops & Algorithms | 6 | 4 | **1.50** | `server.js:88-110` |
| 10 | Poorly Optimized Regex | 4 | 2 | **2.00** | `server.js:148-152` |

---

## Detailed Issue Breakdown

### 1. Missing Database Indexes ⭐ HIGHEST PRIORITY
**Priority Score: 4.50**

**Impact: 9/10**
- Every query on large tables becomes a full table scan
- `products`, `orders`, and `users` tables grow without indexes on frequently searched columns
- Could cause query execution times to degrade from milliseconds to seconds

**Effort: 2/10**
- Simple SQL `CREATE INDEX` statements
- No code changes required, only database schema

**Location:** `database.js` (initializeDatabase function)

**Affected Endpoints:**
- `/api/orders` - queries by user_id
- `/api/stats/category/:category` - queries by category
- `/api/logs` - full table scan

**Recommended Fix:**
```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

**Expected Gain:** 50-100x faster queries on indexed columns

---

### 2. Synchronous File Operations
**Priority Score: 3.00**

**Impact: 6/10**
- `fs.writeFileSync()` and `fs.readFileSync()` block the entire event loop
- Requests during file I/O are queued and experience delays
- In high-traffic scenarios, can cause severe server-wide slowdowns

**Effort: 2/10**
- Replace `writeFileSync` → `writeFile` or `promises.writeFile`
- Replace `readFileSync` → `readFile` or `promises.readFile`
- Add basic error handling for async operations

**Location:** `server.js:68-85` (/api/export/orders endpoint)

**Recommended Fix:**
```javascript
const fs = require('fs').promises;

app.get('/api/export/orders', (req, res) => {
  db.all("SELECT * FROM orders", async (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const filePath = `./export_${Date.now()}.json`;
    await fs.writeFile(filePath, JSON.stringify(orders, null, 2));
    const data = await fs.readFile(filePath, 'utf8');
    
    res.json({ file: filePath, size: data.length });
  });
});
```

**Expected Gain:** Unblocked event loop, 10-50ms faster response times

---

### 3. N+1 Database Queries
**Priority Score: 1.80**

**Impact: 9/10**
- Fetches all orders (1 query), then for each order fetches user data (+N queries) and items (+N queries)
- With 1000 orders: 1 + 1000 + 1000 = **2001 database queries**
- Execution time: seconds instead of milliseconds

**Effort: 5/10**
- Requires SQL JOIN refactoring
- Must restructure response handling logic
- More complex error handling needed

**Location:** `server.js:30-65` (/api/orders endpoint)

**Recommended Fix:**
```javascript
app.get('/api/orders', (req, res) => {
  const limit = req.query.limit || 100; // Add pagination
  const offset = (req.query.page - 1) * limit || 0;
  
  db.all(`
    SELECT 
      o.*,
      u.username,
      u.email,
      json_group_array(json_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity)) as items
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    GROUP BY o.id
    LIMIT ? OFFSET ?
  `, [limit, offset], (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ orders });
  });
});
```

**Expected Gain:** 2000x fewer queries, 100x faster response

---

### 4. No Pagination on Large Result Sets
**Priority Score: 2.67**

**Impact: 8/10**
- `/api/orders` returns unlimited results (defaults to 1000)
- `/api/logs` returns **all logs** - could be millions of records
- Memory spikes, network bandwidth issues, client crashes

**Effort: 3/10**
- Add LIMIT and OFFSET to SQL queries
- Update query parameters in routes
- Add pagination metadata to responses

**Location:** Multiple routes - `server.js:30-65`, `server.js:215-225`

**Recommended Fix:**
```javascript
const page = Math.max(1, parseInt(req.query.page) || 1);
const limit = Math.min(100, parseInt(req.query.limit) || 20);
const offset = (page - 1) * limit;

// Apply LIMIT and OFFSET to all queries
db.all(
  "SELECT * FROM orders LIMIT ? OFFSET ?",
  [limit, offset],
  (err, orders) => { ... }
);
```

**Expected Gain:** 50-100MB reduction in memory per request, 10x bandwidth savings

---

### 5. No Caching Layer (Redis-like)
**Priority Score: 1.75**

**Impact: 7/10**
- `/api/stats/category/:category` runs expensive aggregation on every request
- Same calculation repeated thousands of times unnecessarily
- Stats don't change frequently but are computed every time

**Effort: 4/10**
- Would require Redis or in-memory cache setup
- Cache invalidation logic needed
- TTL/expiration handling required

**Location:** `server.js:152-184` (/api/stats/category route)

**Recommended Fix (In-Memory Cache):**
```javascript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

app.get('/api/stats/category/:category', (req, res) => {
  const cacheKey = `stats_${req.params.category}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  // ... compute stats ...
  cache.set(cacheKey, { data: stats, timestamp: Date.now() });
  res.json(stats);
});
```

**Expected Gain:** 90%+ reduction in expensive queries with proper TTL

---

### 6. Memory Leaks (Event Listeners Not Cleaned Up)
**Priority Score: 2.33**

**Impact: 7/10**
- `/api/orders/:orderId/subscribe` adds listeners but never removes them
- After 1000 subscriptions: 1000 unreferenced listeners still in memory
- Gradual memory growth over time; eventual out-of-memory crash

**Effort: 3/10**
- Add unsubscribe endpoint
- Implement cleanup/garbage collection
- Add subscription tracking

**Location:** `server.js:130-145` (/api/orders/:orderId/subscribe endpoint)

**Recommended Fix:**
```javascript
const subscriptions = new Map();

app.post('/api/orders/:orderId/subscribe', (req, res) => {
  const orderId = req.params.orderId;
  const clientId = uuidv4();
  
  if (!subscriptions.has(orderId)) {
    subscriptions.set(orderId, new Set());
  }
  
  subscriptions.get(orderId).add(clientId);
  res.json({ clientId, subscriptionId: orderId });
});

app.delete('/api/subscriptions/:clientId', (req, res) => {
  for (const clients of subscriptions.values()) {
    clients.delete(req.params.clientId);
  }
  res.json({ unsubscribed: true });
});
```

**Expected Gain:** Stable memory footprint, prevent memory exhaustion

---

### 7. Uncompressed API Responses
**Priority Score: 2.00**

**Impact: 6/10**
- `/api/bulk-data` returns large JSON without gzip compression
- Response sizes 5-10x larger than necessary
- Slow network transfer, increased bandwidth costs

**Effort: 3/10**
- Enable gzip compression middleware
- Could be as simple as one line: `app.use(compression())`
- Requires npm package: `compression`

**Location:** `server.js:212-231` (/api/bulk-data endpoint)

**Recommended Fix:**
```javascript
const compression = require('compression');

app.use(compression({
  level: 6, // compression level 0-9
  threshold: 1024 // only compress > 1KB
}));
```

**Expected Gain:** 80-90% reduction in response sizes (5-10x smaller)

---

### 8. Poorly Optimized Regex
**Priority Score: 2.00**

**Impact: 4/10**
- Email validation regex has catastrophic backtracking: `/^([a-zA-Z0-9]+)*@([a-zA-Z0-9]+)*\.([a-zA-Z0-9]+)*$/`
- Input like `aaaaaaaaaaaaaaab@` causes exponential matching attempts
- Can hang or CPU spike on malicious/malformed input

**Effort: 2/10**
- Replace with simpler, proven regex or library
- Use npm package like `email-validator` or `validator.js`
- Test edge cases

**Location:** `server.js:148-152` (/api/validate/email endpoint)

**Recommended Fix:**
```javascript
const validator = require('email-validator');

app.post('/api/validate/email', (req, res) => {
  const isValid = validator.validate(req.body.email);
  res.json({ valid: isValid });
});

// Or simpler regex:
const simpleEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

**Expected Gain:** Prevent ReDoS attacks, instant validation response

---

### 9. Inefficient Loops & Algorithms
**Priority Score: 1.50**

**Impact: 6/10**
- Product search uses nested O(n²) loop to find duplicates
- String concatenation in loop (Issue #3) uses repeated string concatenation
- With 1000 products: 1M loop iterations for duplicate checking
- Linear scan without indexing or proper search

**Effort: 4/10**
- Replace nested loops with `Set` or `Map`
- Use array methods like `filter()`, `find()`
- Replace string concatenation with `Array.join()` or template strings

**Location:** `server.js:88-110` (/api/products/search and /api/products/process)

**Recommended Fix:**
```javascript
// Instead of nested loops
const results = new Set();
for (const product of products) {
  if (product.name.toLowerCase().includes(query)) {
    results.add(product);
  }
}

// Instead of string concatenation in loop
const result = products
  .map(p => `Product: ${p.name}, Price: $${p.price}`)
  .join('\n');
```

**Expected Gain:** 1000x faster search, 10x faster string building

---

### 10. Missing Connection Pooling
**Priority Score: 1.25**

**Impact: 5/10**
- Each request creates individual database connections
- Under high concurrency (100+ simultaneous requests), exhausts database limits
- Connection overhead adds latency to each query
- Database connection limit could be exceeded, causing request failures

**Effort: 4/10**
- Implement connection pooling (better-sqlite3, pg-pool, or similar)
- Refactor database.js to use pool
- Update all query methods to use pooled connections

**Location:** `database.js` (entire database connection layer)

**Recommended Fix:**
```javascript
const sqlite3 = require('sqlite3');
const Queue = require('queue-promise');

class ConnectionPool {
  constructor(dbPath, poolSize = 10) {
    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      this.pool.push(new sqlite3.Database(dbPath));
    }
    this.queue = new Queue({ concurrency: poolSize });
  }
  
  query(sql, params) {
    return this.queue.add(() => {
      return new Promise((resolve, reject) => {
        const conn = this.pool[Math.floor(Math.random() * this.pool.length)];
        conn.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    });
  }
}
```

**Expected Gain:** Stable response times under load, prevent connection exhaustion

---

## Implementation Roadmap

### Quick Wins (1-3 hours total)
1. **Add database indexes** (Priority 4.50) - 30 min
2. **Switch to async file operations** (Priority 3.00) - 30 min
3. **Fix poorly optimized regex** (Priority 2.00) - 15 min
4. **Enable response compression** (Priority 2.00) - 15 min

**Expected Result:** ~50-70% performance improvement

### Medium-Term Improvements (3-8 hours total)
5. **Implement pagination** (Priority 2.67) - 1.5 hours
6. **Fix memory leaks** (Priority 2.33) - 1 hour
7. **Implement basic caching** (Priority 1.75) - 1.5 hours
8. **Optimize loops & algorithms** (Priority 1.50) - 1.5 hours

**Expected Result:** ~80-90% performance improvement

### Long-Term Refactoring (8+ hours)
9. **Eliminate N+1 queries** (Priority 1.80) - 3 hours
10. **Implement connection pooling** (Priority 1.25) - 2 hours

**Expected Result:** ~95%+ performance improvement

---

## Summary

- **Highest ROI Improvements:** Database indexes → Async file ops → Pagination → Caching
- **Quickest Wins:** Add indexes (2/10 effort, 9/10 impact = 4.50 priority)
- **Most Critical Fix:** N+1 queries causing 2000+ queries per request
- **Memory Safety:** Add unsubscribe mechanism to prevent gradual leaks
- **Production Stability:** Connection pooling + pagination prevent resource exhaustion

Implementing all 10 fixes would result in **10-100x overall performance improvement** and significantly improved stability under load.
