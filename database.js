const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(dbPath);

// Initialize database schema with indexes (Issue #2 - FIXED)
function initializeDatabase() {
  db.serialize(() => {
    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        email TEXT,
        created_at DATETIME
      )
    `);

    // Create products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT,
        price REAL,
        category TEXT,
        stock INTEGER,
        created_at DATETIME
      )
    `);

    // Create orders table
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        total_amount REAL,
        status TEXT,
        created_at DATETIME
      )
    `);

    // Create order_items table
    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        product_id TEXT,
        quantity INTEGER,
        price REAL
      )
    `);

    // Create logs table
    db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT,
        timestamp DATETIME
      )
    `);

    // Create indexes for frequently queried columns (Performance optimization)
    db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

    // Seed sample data
    seedDatabase();
  });
}

function seedDatabase() {
  const { v4: uuidv4 } = require('uuid');
  
  db.all("SELECT COUNT(*) as count FROM users", (err, rows) => {
    if (err) return;
    
    if (rows && rows[0].count === 0) {
      // Add sample users
      for (let i = 1; i <= 50; i++) {
        db.run(
          "INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, ?)",
          [uuidv4(), `user${i}`, `user${i}@example.com`, new Date().toISOString()]
        );
      }

      // Add sample products
      const categories = ['Electronics', 'Clothing', 'Books', 'Home'];
      for (let i = 1; i <= 100; i++) {
        const category = categories[Math.floor(Math.random() * categories.length)];
        db.run(
          "INSERT INTO products (id, name, price, category, stock, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [uuidv4(), `Product ${i}`, Math.random() * 500, category, Math.floor(Math.random() * 1000), new Date().toISOString()]
        );
      }

      // Add sample orders
      for (let i = 1; i <= 1000; i++) {
        db.run(
          "INSERT INTO orders (id, user_id, total_amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
          [uuidv4(), Math.floor(Math.random() * 50) + 1, Math.random() * 5000, 'completed', new Date().toISOString()]
        );
      }
    }
  });
}

module.exports = { db, initializeDatabase };
