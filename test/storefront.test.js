const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const Stripe = require('stripe');
const {
  closeDatabase,
  createStoreDatabase,
  initializeDatabase,
  openDatabase
} = require('../database');
const { createApp } = require('../server');

test('checkout, signed payment fulfillment, order lookup, and protected download', async (t) => {
  const rawDb = openDatabase(':memory:');
  await initializeDatabase(rawDb);
  const database = createStoreDatabase(rawDb);
  const stripe = new Stripe('sk_test_example');
  let checkoutOptions;
  let emailCount = 0;
  stripe.checkout.sessions.create = async (options) => {
    checkoutOptions = options;
    return { id: 'cs_test_fortday_1', url: 'https://checkout.stripe.test/session' };
  };

  const config = {
    baseUrl: 'http://localhost',
    stripeWebhookSecret: 'whsec_test_fortday',
    supportEmail: 'help@example.com',
    crmWebhookUrl: '',
    crmWebhookSecret: '',
    smtpFrom: 'Fortday <receipts@example.com>'
  };
  const app = createApp({
    database,
    stripe,
    config,
    mailer: { sendMail: async () => { emailCount += 1; } }
  });
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabase(rawDb);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const catalogResponse = await fetch(`${baseUrl}/api/products`);
  assert.equal(catalogResponse.status, 200);
  const { products } = await catalogResponse.json();
  assert.equal(products.length, 3);
  const product = products.find((item) => item.id === 'fortday-weekly-planner');
  assert.equal(product.amount > 0, true);

  const invalidCheckout = await fetch(`${baseUrl}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: 'not-an-email' })
  });
  assert.equal(invalidCheckout.status, 400);

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: product.id, email: 'Buyer@Example.com' })
  });
  assert.equal(checkoutResponse.status, 201);
  assert.equal((await checkoutResponse.json()).checkoutUrl, 'https://checkout.stripe.test/session');
  assert.equal(checkoutOptions.customer_email, 'buyer@example.com');

  const payment = {
    id: 'cs_test_fortday_1',
    object: 'checkout.session',
    payment_status: 'paid',
    customer_email: 'buyer@example.com',
    customer_details: { email: 'buyer@example.com' },
    amount_total: product.amount,
    currency: product.currency,
    metadata: {
      order_id: checkoutOptions.client_reference_id,
      product_id: product.id
    }
  };
  const eventPayload = JSON.stringify({
    id: 'evt_test_fortday_1',
    object: 'event',
    created: Math.floor(Date.now() / 1000),
    data: { object: payment },
    livemode: false,
    pending_webhooks: 1,
    type: 'checkout.session.completed'
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: config.stripeWebhookSecret
  });

  const invalidWebhook = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'invalid' },
    body: eventPayload
  });
  assert.equal(invalidWebhook.status, 400);

  const webhookResponse = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: eventPayload
  });
  assert.equal(webhookResponse.status, 200);
  assert.equal(emailCount, 1);

  const confirmationResponse = await fetch(`${baseUrl}/api/orders/session/cs_test_fortday_1`);
  assert.equal(confirmationResponse.status, 200);
  const confirmation = await confirmationResponse.json();
  assert.equal(confirmation.orderId, checkoutOptions.client_reference_id);
  assert.equal(confirmation.productName, product.name);

  const lookupResponse = await fetch(`${baseUrl}/api/support/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: confirmation.orderId, email: 'BUYER@example.com' })
  });
  assert.equal(lookupResponse.status, 200);
  assert.equal((await lookupResponse.json()).status, 'paid');

  const deniedLookup = await fetch(`${baseUrl}/api/support/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: confirmation.orderId, email: 'someone-else@example.com' })
  });
  assert.equal(deniedLookup.status, 404);

  const downloadResponse = await fetch(`${baseUrl}${confirmation.downloadUrl}`);
  assert.equal(downloadResponse.status, 200);
  assert.match(await downloadResponse.text(), /FORTDAY WEEKLY PLANNER/);

  const duplicateWebhook = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: eventPayload
  });
  assert.equal((await duplicateWebhook.json()).duplicate, true);
  assert.equal(emailCount, 1);
});
