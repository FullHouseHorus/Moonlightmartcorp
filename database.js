const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const sampleProducts = [
  {
    id: 'fortday-weekly-planner',
    name: 'Fortday Weekly Planner',
    description: 'A printable weekly planner to help you make room for what matters.',
    category: 'Planning',
    amount: 900,
    currency: 'usd',
    fileName: 'weekly-planner.txt'
  },
  {
    id: 'fortday-morning-guide',
    name: 'Mindful Morning Guide',
    description: 'A practical guide to building a calmer, more intentional morning.',
    category: 'Guides',
    amount: 1200,
    currency: 'usd',
    fileName: 'morning-guide.txt'
  },
  {
    id: 'fortday-launch-checklist',
    name: 'Creator Launch Checklist',
    description: 'A straightforward checklist for preparing a digital product launch.',
    category: 'Business',
    amount: 700,
    currency: 'usd',
    fileName: 'launch-checklist.txt'
  }
];

function openDatabase(filename = process.env.DATABASE_PATH || path.join(__dirname, 'app.db')) {
  return new sqlite3.Database(filename);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

async function initializeDatabase(db) {
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, 'PRAGMA journal_mode = WAL');
  await run(db, `
    CREATE TABLE IF NOT EXISTS store_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL,
      file_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS store_orders (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT UNIQUE,
      product_id TEXT NOT NULL REFERENCES store_products(id),
      customer_email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
      download_token TEXT UNIQUE,
      email_sent_at TEXT,
      crm_notified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    )
  `);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_store_orders_email ON store_orders(customer_email)');

  for (const product of sampleProducts) {
    await run(db, `
      INSERT INTO store_products (id, name, description, category, amount, currency, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `, [
      product.id,
      product.name,
      product.description,
      product.category,
      product.amount,
      product.currency,
      product.fileName
    ]);
  }
}

function createStoreDatabase(db) {
  return {
    async listProducts() {
      return all(db, `
        SELECT id, name, description, category, amount, currency
        FROM store_products WHERE active = 1 ORDER BY category, name
      `);
    },
    async getProduct(id) {
      return get(db, 'SELECT * FROM store_products WHERE id = ? AND active = 1', [id]);
    },
    async createPendingOrder(order) {
      await run(db, `
        INSERT INTO store_orders
          (id, stripe_session_id, product_id, customer_email, amount, currency, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `, [
        order.id,
        order.sessionId,
        order.productId,
        order.email,
        order.amount,
        order.currency,
        order.timestamp,
        order.timestamp
      ]);
    },
    async getOrderBySession(sessionId) {
      return get(db, `
        SELECT o.*, p.name AS product_name
        FROM store_orders o JOIN store_products p ON p.id = o.product_id
        WHERE o.stripe_session_id = ?
      `, [sessionId]);
    },
    async getOrderByIdAndEmail(orderId, email) {
      return get(db, `
        SELECT o.*, p.name AS product_name
        FROM store_orders o JOIN store_products p ON p.id = o.product_id
        WHERE o.id = ? AND o.customer_email = ?
      `, [orderId, email]);
    },
    async fulfillOrder({ orderId, sessionId, productId, email, amount, currency, token, timestamp }) {
      const result = await run(db, `
        UPDATE store_orders
        SET status = 'paid', download_token = COALESCE(download_token, ?), updated_at = ?
        WHERE id = ? AND stripe_session_id = ? AND product_id = ? AND customer_email = ?
          AND amount = ? AND currency = ? AND status IN ('pending', 'paid')
      `, [token, timestamp, orderId, sessionId, productId, email, amount, currency]);
      if (result.changes !== 1) {
        throw new Error(`No matching pending order found for Stripe Checkout session ${sessionId}`);
      }
      return this.getOrderBySession(sessionId);
    },
    async markEmailSent(orderId, timestamp) {
      await run(db, 'UPDATE store_orders SET email_sent_at = ? WHERE id = ?', [timestamp, orderId]);
    },
    async markCrmNotified(orderId, timestamp) {
      await run(db, 'UPDATE store_orders SET crm_notified_at = ? WHERE id = ?', [timestamp, orderId]);
    },
    async getOrderByDownloadToken(token) {
      return get(db, `
        SELECT o.*, p.file_name, p.name AS product_name
        FROM store_orders o JOIN store_products p ON p.id = o.product_id
        WHERE o.download_token = ? AND o.status = 'paid'
      `, [token]);
    },
    async isStripeEventProcessed(eventId) {
      return Boolean(await get(db, 'SELECT id FROM stripe_events WHERE id = ?', [eventId]));
    },
    async markStripeEventProcessed(eventId, timestamp) {
      await run(db, 'INSERT OR IGNORE INTO stripe_events (id, processed_at) VALUES (?, ?)', [eventId, timestamp]);
    }
  };
}

module.exports = {
  closeDatabase,
  createStoreDatabase,
  initializeDatabase,
  openDatabase,
  sampleProducts
};
