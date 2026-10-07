require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const {
  closeDatabase,
  createStoreDatabase,
  initializeDatabase,
  openDatabase
} = require('./database');

const PORT = Number(process.env.PORT) || 3000;
const ASSET_DIRECTORY = path.join(__dirname, 'storefront-assets');
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createConfig(env = process.env) {
  const port = Number(env.PORT) || PORT;
  return {
    baseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    supportEmail: env.SUPPORT_EMAIL || '',
    crmWebhookUrl: env.CRM_WEBHOOK_URL || '',
    crmWebhookSecret: env.CRM_WEBHOOK_SECRET || '',
    smtpHost: env.SMTP_HOST || '',
    smtpPort: Number(env.SMTP_PORT) || 587,
    smtpUser: env.SMTP_USER || '',
    smtpPassword: env.SMTP_PASSWORD || '',
    smtpFrom: env.SMTP_FROM || '',
    socialLinks: {
      instagram: safeSocialUrl(env.SOCIAL_INSTAGRAM_URL, 'SOCIAL_INSTAGRAM_URL'),
      facebook: safeSocialUrl(env.SOCIAL_FACEBOOK_URL, 'SOCIAL_FACEBOOK_URL'),
      tiktok: safeSocialUrl(env.SOCIAL_TIKTOK_URL, 'SOCIAL_TIKTOK_URL')
    }
  };
}

function safeSocialUrl(value, key) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${key} must be an HTTPS profile URL without embedded credentials.`);
  }
  return url.href;
}

function createMailer(config) {
  if (!config.smtpHost || !config.smtpFrom) return null;

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser ? {
      user: config.smtpUser,
      pass: config.smtpPassword
    } : undefined
  });
}

async function sendCrmNotification(config, order) {
  if (!config.crmWebhookUrl) return false;
  const payload = JSON.stringify({
    type: 'purchase.completed',
    orderId: order.id,
    email: order.customer_email,
    product: order.product_name,
    amount: order.amount,
    currency: order.currency,
    purchasedAt: order.updated_at
  });
  const headers = { 'content-type': 'application/json' };
  if (config.crmWebhookSecret) {
    headers['x-fortday-signature'] = crypto
      .createHmac('sha256', config.crmWebhookSecret)
      .update(payload)
      .digest('hex');
  }

  const response = await fetch(config.crmWebhookUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`CRM webhook returned HTTP ${response.status}`);
  }
  return true;
}

function createApp({ database, stripe, config = createConfig(), mailer = createMailer(config) }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/config', (req, res) => {
    res.json({ supportEmail: config.supportEmail, socialLinks: config.socialLinks });
  });

  app.get('/api/products', asyncRoute(async (req, res) => {
    const products = await database.listProducts();
    res.json({ products });
  }));

  app.post('/api/checkout', express.json({ limit: '10kb' }), asyncRoute(async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Checkout is not configured. Add STRIPE_SECRET_KEY to the environment.' });
    }
    const { productId, email } = req.body || {};
    if (typeof productId !== 'string' || typeof email !== 'string' ||
        email.length > 254 || !emailPattern.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address and select a product.' });
    }

    const product = await database.getProduct(productId);
    if (!product) return res.status(404).json({ error: 'That product is not available.' });

    const orderId = crypto.randomUUID();
    const customerEmail = email.trim().toLowerCase();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: orderId,
      customer_email: customerEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: product.currency,
          unit_amount: product.amount,
          product_data: {
            name: product.name,
            description: product.description
          }
        }
      }],
      metadata: { order_id: orderId, product_id: product.id },
      success_url: `${config.baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60
    });

    await database.createPendingOrder({
      id: orderId,
      sessionId: session.id,
      productId: product.id,
      email: customerEmail,
      amount: product.amount,
      currency: product.currency,
      timestamp: new Date().toISOString()
    });
    res.status(201).json({ checkoutUrl: session.url });
  }));

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (req, res) => {
    if (!stripe || !config.stripeWebhookSecret) {
      return res.status(503).send('Stripe webhooks are not configured.');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get('stripe-signature'),
        config.stripeWebhookSecret
      );
    } catch (error) {
      console.warn(`Rejected Stripe webhook: ${error.message}`);
      return res.status(400).send('Invalid Stripe signature.');
    }

    if (await database.isStripeEventProcessed(event.id)) {
      return res.json({ received: true, duplicate: true });
    }

    const isCheckoutPaid = event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded';
    if (isCheckoutPaid) {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const orderId = session.metadata && session.metadata.order_id;
        const productId = session.metadata && session.metadata.product_id;
        const email = session.customer_details && session.customer_details.email || session.customer_email;
        if (!orderId || !productId || !email || !Number.isInteger(session.amount_total) || !session.currency) {
          return res.status(400).send('Checkout session is missing required purchase details.');
        }

        const order = await database.fulfillOrder({
          orderId,
          sessionId: session.id,
          productId,
          email: email.toLowerCase(),
          amount: session.amount_total,
          currency: session.currency.toLowerCase(),
          token: crypto.randomBytes(32).toString('hex'),
          timestamp: new Date().toISOString()
        });

        if (!order.email_sent_at && mailer) {
          const downloadUrl = `${config.baseUrl}/api/download/${order.download_token}`;
          await mailer.sendMail({
            from: config.smtpFrom,
            to: order.customer_email,
            subject: `Your ${order.product_name} download`,
            text: `Thanks for your purchase. Your order number is ${order.id}.\n\nDownload ${order.product_name} here: ${downloadUrl}\n\nIf you need help, contact ${config.supportEmail || 'our support team'}.`
          });
          await database.markEmailSent(order.id, new Date().toISOString());
        }

        if (!order.email_sent_at && !mailer) {
          console.warn(`SMTP is not configured; receipt email for order ${order.id} was not sent.`);
        }

        if (!order.crm_notified_at && config.crmWebhookUrl) {
          await sendCrmNotification(config, order);
          await database.markCrmNotified(order.id, new Date().toISOString());
        }
      }
    }

    await database.markStripeEventProcessed(event.id, new Date().toISOString());
    res.json({ received: true });
  }));

  app.get('/api/orders/session/:sessionId', asyncRoute(async (req, res) => {
    const order = await database.getOrderBySession(req.params.sessionId);
    if (!order || order.status !== 'paid') {
      return res.status(404).json({ error: 'A completed purchase for this session was not found yet.' });
    }
    res.json({
      orderId: order.id,
      productName: order.product_name,
      downloadUrl: `/api/download/${order.download_token}`
    });
  }));

  app.post('/api/support/order', express.json({ limit: '10kb' }), asyncRoute(async (req, res) => {
    const { orderId, email } = req.body || {};
    if (typeof orderId !== 'string' || typeof email !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(orderId) || email.length > 254 || !emailPattern.test(email)) {
      return res.status(400).json({ error: 'Enter the order number and the email used at checkout.' });
    }
    const order = await database.getOrderByIdAndEmail(orderId, email.trim().toLowerCase());
    if (!order) return res.status(404).json({ error: 'We could not find an order with those details.' });

    const result = {
      orderId: order.id,
      productName: order.product_name,
      status: order.status
    };
    if (order.status === 'paid') {
      result.downloadUrl = `/api/download/${order.download_token}`;
    }
    res.json(result);
  }));

  app.get('/api/download/:token', asyncRoute(async (req, res, next) => {
    const order = await database.getOrderByDownloadToken(req.params.token);
    if (!order) return res.status(404).json({ error: 'This download link is invalid or unavailable.' });

    const filePath = path.resolve(ASSET_DIRECTORY, order.file_name);
    if (path.dirname(filePath) !== ASSET_DIRECTORY) {
      return res.status(500).json({ error: 'The product download is misconfigured.' });
    }
    res.download(filePath, path.basename(filePath), (error) => {
      if (error && !res.headersSent) next(error);
    });
  }));

  app.use(express.static(PUBLIC_DIRECTORY, { index: 'index.html' }));

  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    const message = status === 413
      ? 'Request body is too large.'
      : status === 400
        ? 'Invalid request body.'
        : 'An unexpected server error occurred.';
    res.status(status).json({ error: message });
  });

  return app;
}

async function start() {
  const config = createConfig();
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const rawDb = openDatabase();
  rawDb.on('error', (error) => console.error('SQLite error:', error));
  await initializeDatabase(rawDb);
  const database = createStoreDatabase(rawDb);
  const app = createApp({ database, stripe, config });
  const server = app.listen(PORT, () => {
    console.log(`Fortday storefront listening on port ${PORT}`);
    if (!stripe) console.warn('Stripe is not configured; checkout endpoints will return 503.');
    if (!config.stripeWebhookSecret) console.warn('Stripe webhooks are not configured.');
  });

  const shutdown = () => {
    server.close(async (error) => {
      if (error) console.error('HTTP server shutdown failed:', error);
      try {
        await closeDatabase(rawDb);
      } catch (databaseError) {
        console.error('Database shutdown failed:', databaseError);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Unable to start the storefront:', error);
    process.exitCode = 1;
  });
}

module.exports = { createApp, createConfig, createMailer };
