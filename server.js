const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db, initializeDatabase } = require('./database');

const app = express();
const PORT = 3000;

// Global event listeners that leak memory (Issue #8)
const eventListeners = {};

app.use(express.json());

// Middleware with inefficient regex (Issue #7)
const inefficientRegex = /^\/api\/[a-zA-Z0-9]*\/[a-zA-Z0-9]*\/[a-zA-Z0-9]*\/[a-zA-Z0-9]*\/[a-zA-Z0-9]*\/users\/[a-zA-Z0-9\-]*$/;

app.use((req, res, next) => {
  // Inefficient regex matching on every request
  if (inefficientRegex.test(req.url)) {
    // Intentionally expensive operation
  }
  next();
});

// Route 1: N+1 Query Problem (Issue #1)
// Fetches all orders, then for each order, fetches user data and items separately
app.get('/api/orders', (req, res) => {
  const limit = req.query.limit || 1000; // No pagination (Issue #9)
  
  db.all(
    "SELECT * FROM orders LIMIT ?",
    [limit],
    (err, orders) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // N+1 problem: one query per order to fetch user
      let enrichedOrders = [];
      let completed = 0;

      orders.forEach((order) => {
        db.get(
          "SELECT * FROM users WHERE id = ?",
          [order.user_id],
          (err, user) => {
            if (!err && user) {
              // Another query per order to fetch items
              db.all(
                "SELECT * FROM order_items WHERE order_id = ?",
                [order.id],
                (err, items) => {
                  enrichedOrders.push({
                    ...order,
                    user: user,
                    items: items || []
                  });

                  completed++;
                  if (completed === orders.length) {
                    // Response is not compressed (Issue #6)
                    res.json({ orders: enrichedOrders });
                  }
                }
              );
            }
          }
        );
      });

      if (orders.length === 0) {
        res.json({ orders: [] });
      }
    }
  );
});

// Route 2: Synchronous file operations (Issue #5)
app.get('/api/export/orders', (req, res) => {
  db.all("SELECT * FROM orders", (err, orders) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Synchronous file write - blocks the event loop
    const filePath = `./export_${Date.now()}.json`;
    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));
    
    // Another synchronous operation
    const data = fs.readFileSync(filePath, 'utf8');

    res.json({ file: filePath, size: data.length });
  });
});

// Route 3: Inefficient loops and algorithms (Issue #3)
app.get('/api/products/search', (req, res) => {
  const query = req.query.q || '';

  db.all("SELECT * FROM products", (err, products) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // O(n²) search algorithm using nested loops
    const results = [];
    for (let i = 0; i < products.length; i++) {
      for (let j = 0; j < products.length; j++) {
        if (products[i].name.toLowerCase().includes(query.toLowerCase())) {
          if (!results.includes(products[i])) {
            results.push(products[i]);
          }
        }
      }
    }

    res.json({ results });
  });
});

// Route 4: Inefficient string manipulation in loop
app.get('/api/products/process', (req, res) => {
  db.all("SELECT * FROM products", (err, products) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // String concatenation in loop (extremely inefficient)
    let result = '';
    for (let i = 0; i < products.length; i++) {
      result += 'Product: ' + products[i].name + ', Price: $' + products[i].price + '\n';
    }

    res.json({ data: result });
  });
});

// Route 5: Memory leak with event listeners (Issue #8)
app.post('/api/orders/:orderId/subscribe', (req, res) => {
  const orderId = req.params.orderId;
  const clientId = uuidv4();

  if (!eventListeners[orderId]) {
    eventListeners[orderId] = [];
  }

  // These listeners are never cleaned up
  const listener = () => {
    console.log(`Order ${orderId} updated for client ${clientId}`);
  };

  eventListeners[orderId].push(listener);

  // No unsubscribe mechanism - memory leak
  res.json({ message: 'Subscribed', clientId });
});

// Route 6: Poorly optimized regex (Issue #7)
app.post('/api/validate/email', (req, res) => {
  const email = req.body.email;

  // Catastrophic backtracking regex
  const poorlyOptimizedRegex = /^([a-zA-Z0-9]+)*@([a-zA-Z0-9]+)*\.([a-zA-Z0-9]+)*$/;

  const isValid = poorlyOptimizedRegex.test(email);
  res.json({ valid: isValid });
});

// Route 7: No caching layer (Issue #4)
// Same expensive query runs every time without caching
app.get('/api/stats/category/:category', (req, res) => {
  const category = req.category || req.params.category;

  // No Redis or caching - this runs every single time
  db.all(
    "SELECT * FROM products WHERE category = ? LIMIT 10000",
    [category],
    (err, products) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Expensive calculation repeated every time
      let stats = {
        total: products.length,
        avgPrice: 0,
        totalValue: 0,
        priceDistribution: {}
      };

      for (let i = 0; i < products.length; i++) {
        stats.totalValue += products[i].price;
        const priceRange = Math.floor(products[i].price / 100);
        stats.priceDistribution[priceRange] = (stats.priceDistribution[priceRange] || 0) + 1;
      }

      stats.avgPrice = stats.totalValue / products.length;

      res.json(stats);
    }
  );
});

// Route 8: Missing connection pooling on database (Issue #10)
app.get('/api/concurrent/data', (req, res) => {
  // Each request opens a new database connection without pooling
  let results = { users: null, products: null, orders: null };
  let completed = 0;

  db.all("SELECT * FROM users LIMIT 100", (err, users) => {
    results.users = users;
    completed++;
    if (completed === 3) {
      res.json(results);
    }
  });

  db.all("SELECT * FROM products LIMIT 100", (err, products) => {
    results.products = products;
    completed++;
    if (completed === 3) {
      res.json(results);
    }
  });

  db.all("SELECT * FROM orders LIMIT 100", (err, orders) => {
    results.orders = orders;
    completed++;
    if (completed === 3) {
      res.json(results);
    }
  });
});

// Route 9: Uncompressed responses (Issue #6)
app.get('/api/bulk-data', (req, res) => {
  db.all("SELECT * FROM products", (err, products) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Large response without compression
    const largeData = {
      timestamp: new Date(),
      products: products,
      // Duplicate data to make response large
      duplicates: products.concat(products).concat(products)
    };

    // No Content-Encoding header, no gzip
    res.json(largeData);
  });
});

// Route 10: Query without pagination (Issue #9)
app.get('/api/logs', (req, res) => {
  // Returns ALL logs without pagination or limit
  db.all("SELECT * FROM logs", (err, logs) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ logs });
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initialize and start server
initializeDatabase();

app.listen(PORT, () => {
  console.log(`Moonlight Mart API listening on port ${PORT}`);
});
