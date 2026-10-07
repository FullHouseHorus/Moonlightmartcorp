const productsElement = document.querySelector('#products');
const noticeElement = document.querySelector('#notice');
const launchCaptions = {
  instagram: 'Make room for what matters. 🌿\n\nMeet Fortday: thoughtful digital tools to help you plan your week, find your rhythm, and bring good ideas to life.\n\nExplore the collection at {url}\n\n#Fortday #MindfulPlanning #CreativeLife',
  facebook: 'A little more intention, every day. Fortday brings together thoughtful guides and practical digital tools to help make your days feel more like your own.\n\nTake a look at the collection: {url}',
  tiktok: 'Your reminder to make room for what matters 🌱 Thoughtful little tools for your week, your morning, and the ideas you can’t wait to bring to life. Find your next favorite at {url} #Fortday #DailyInspiration'
};
let selectedCaptionPlatform = 'instagram';

function showNotice(message, kind = 'info') {
  noticeElement.textContent = message;
  noticeElement.className = `notice notice-${kind}`;
  noticeElement.hidden = false;
}

function formatPrice(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100);
}

function makeProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';

  const artwork = document.createElement('div');
  artwork.className = 'product-art';
  artwork.setAttribute('aria-hidden', 'true');
  const number = document.createElement('span');
  number.textContent = String(product.category).slice(0, 1).toUpperCase();
  artwork.append(number);

  const category = document.createElement('p');
  category.className = 'eyebrow';
  category.textContent = product.category;
  const title = document.createElement('h3');
  title.textContent = product.name;
  const description = document.createElement('p');
  description.className = 'product-description';
  description.textContent = product.description;
  const form = document.createElement('form');
  form.className = 'checkout-form';
  const email = document.createElement('input');
  email.type = 'email';
  email.name = 'email';
  email.autocomplete = 'email';
  email.required = true;
  email.placeholder = 'Email for your receipt';
  email.setAttribute('aria-label', `Email for your receipt for ${product.name}`);
  const price = document.createElement('strong');
  price.textContent = formatPrice(product.amount, product.currency);
  const button = document.createElement('button');
  button.className = 'button button-outline';
  button.type = 'submit';
  button.textContent = 'Get the download';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    beginCheckout(product, email.value.trim(), button);
  });

  const footer = document.createElement('div');
  footer.className = 'product-footer';
  footer.append(price, button);
  form.append(email, footer);
  card.append(artwork, category, title, description, form);
  return card;
}

async function beginCheckout(product, email, button) {
  button.disabled = true;
  button.textContent = 'Opening secure checkout…';

  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: product.id, email })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to start checkout.');
    window.location.assign(result.checkoutUrl);
  } catch (error) {
    showNotice(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Get the download';
  }
}

async function loadProducts() {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('The collection could not be loaded. Please refresh to try again.');
    const { products } = await response.json();
    productsElement.replaceChildren(...products.map(makeProductCard));
    if (products.length === 0) {
      productsElement.textContent = 'The collection is being refreshed. Please check back soon.';
    }
  } catch (error) {
    productsElement.textContent = error.message;
  }
}

async function showPurchaseResult(sessionId) {
  showNotice('Payment received — preparing your download…');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`/api/orders/session/${encodeURIComponent(sessionId)}`);
      if (response.ok) {
        const order = await response.json();
        const link = document.createElement('a');
        link.href = order.downloadUrl;
        link.textContent = `Download ${order.productName}`;
        link.className = 'button button-dark';
        noticeElement.replaceChildren(
          document.createTextNode(`Thank you for your purchase. Order ${order.orderId}. Your download is ready. `),
          link
        );
        noticeElement.className = 'notice notice-success';
        return;
      }
      if (response.status !== 404) throw new Error('We could not confirm this order. Please contact support.');
    } catch (error) {
      if (attempt === 9) {
        showNotice(error.message || 'Your payment went through, but the download is not ready yet. Check your email or contact support.', 'error');
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 + attempt * 500, 2500)));
  }
  showNotice('Your payment is being confirmed. Your download link will arrive by email shortly.');
}

async function loadSupportAddress() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const config = await response.json();
    if (config.supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail)) {
      const link = document.querySelector('#support-link');
      link.href = `mailto:${config.supportEmail}`;
      link.textContent = `Contact ${config.supportEmail} ↗`;
    }
    const platforms = [
      { key: 'instagram', name: 'Instagram' },
      { key: 'facebook', name: 'Facebook' },
      { key: 'tiktok', name: 'TikTok' }
    ];
    const links = platforms
      .filter(({ key }) => config.socialLinks && config.socialLinks[key])
      .map(({ key, name }) => {
        const link = document.createElement('a');
        link.className = 'button button-outline';
        link.href = config.socialLinks[key];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Follow on ${name} ↗`;
        return link;
      });
    const socialLinksElement = document.querySelector('#social-links');
    if (links.length) {
      socialLinksElement.replaceChildren(...links);
    } else {
      socialLinksElement.textContent = 'Social profile links will appear here once they are configured.';
    }
  } catch (error) {
    console.error('Could not load the support email address:', error);
  }
}

document.querySelector('#copy-caption').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    const caption = launchCaptions[selectedCaptionPlatform].replace('{url}', window.location.origin);
    await navigator.clipboard.writeText(caption);
    button.textContent = 'Copied — ready to share';
    window.setTimeout(() => {
      button.textContent = 'Copy launch caption';
    }, 2500);
  } catch (error) {
    showNotice('Copying is unavailable in this browser. Select the caption text to copy it.', 'error');
    console.error('Could not copy the launch caption:', error);
  }
});

document.querySelectorAll('.caption-platform').forEach((button) => {
  button.addEventListener('click', () => {
    selectedCaptionPlatform = button.dataset.platform;
    document.querySelectorAll('.caption-platform').forEach((platformButton) => {
      const isSelected = platformButton === button;
      platformButton.classList.toggle('is-selected', isSelected);
      platformButton.setAttribute('aria-pressed', String(isSelected));
    });
    document.querySelector('#launch-caption').textContent =
      launchCaptions[selectedCaptionPlatform].replace('{url}', window.location.origin);
  });
});

document.querySelector('#order-lookup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const resultElement = document.querySelector('#order-result');
  const button = form.querySelector('button');
  const formData = new FormData(form);
  button.disabled = true;
  resultElement.textContent = 'Looking up your order…';

  try {
    const response = await fetch('/api/support/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: formData.get('orderId').trim(),
        email: formData.get('email').trim()
      })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || 'Unable to find that order.');

    resultElement.replaceChildren(
      document.createTextNode(`${order.productName} — ${order.status}. `)
    );
    if (order.downloadUrl) {
      const link = document.createElement('a');
      link.href = order.downloadUrl;
      link.textContent = 'Download again';
      resultElement.append(link);
    }
  } catch (error) {
    resultElement.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const query = new URLSearchParams(window.location.search);
if (query.get('checkout') === 'cancelled') {
  showNotice('No charge was made. Your collection is still here whenever you are ready.', 'info');
} else if (query.get('checkout') === 'success' && query.get('session_id')) {
  showPurchaseResult(query.get('session_id'));
  window.history.replaceState({}, '', '/');
}

loadProducts();
loadSupportAddress();
document.querySelector('#launch-caption').textContent =
  launchCaptions[selectedCaptionPlatform].replace('{url}', window.location.origin);
