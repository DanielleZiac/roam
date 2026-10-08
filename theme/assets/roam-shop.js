/*
 * Shop features shared by every page:
 *   - Quick add: the + button on a product card adds it to the cart without leaving the page.
 *   - Saved gear: the heart button keeps a product in a list on this device.
 *   - Recently viewed: product pages are remembered and shown as a row of cards.
 *
 * Saved and recently viewed live in localStorage only. Nothing is sent to a server.
 * Without JavaScript the + button still works: it posts the form and opens the cart.
 */
(() => {
  const SAVED_KEY = 'roam:saved';
  const VIEWED_KEY = 'roam:viewed';
  const PICKS_KEY = 'roam:picks';
  const SUGGESTION_KEY = 'roam:last-suggestion';
  const MAX_VIEWED = 8;

  const stringsNode = document.querySelector('[data-shop-strings]');
  const strings = stringsNode ? JSON.parse(stringsNode.textContent) : {};
  const status = document.querySelector('[data-shop-status]');

  function text(key, title) {
    return (strings[key] || '').replace('[title]', title || '');
  }

  // Screen readers hear this; nothing visible changes.
  function announce(message) {
    if (!status) return;
    status.textContent = '';
    requestAnimationFrame(() => {
      status.textContent = message;
    });
  }

  // A visible confirmation that slides up for a few seconds. Screen readers hear it as well.
  const toast = document.querySelector('[data-shop-toast]');
  let toastTimer = null;

  // `action` picks the link shown beside the message: "cart", "saved", or none.
  function showToast(message, action) {
    if (!toast) return announce(message);
    toast.querySelector('[data-shop-toast-text]').textContent = message;
    toast.querySelectorAll('[data-toast-action]').forEach((link) => {
      link.hidden = link.dataset.toastAction !== action;
    });
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
  }

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // Storage can be blocked. The page keeps working, the list just is not remembered.
    }
  }

  function icon(name) {
    const template = document.querySelector(`template[data-icon="${name}"]`);
    return template ? template.content.cloneNode(true) : document.createTextNode('');
  }

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content) element.textContent = content;
    return element;
  }

  // The need group's label with its icon in front, as the product-card snippet renders it.
  function typeLabel(type) {
    const label = node('p', 'product-card__type');
    const key = String(type || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const template = document.querySelector(`template[data-need-icon="${key}"]`);
    if (template) label.append(template.content.cloneNode(true));
    label.append(type || '');
    return label;
  }

  // Builds the same card the product-card snippet renders, from saved product details.
  function card(product) {
    const item = node('li');
    const article = node('article', 'product-card');

    if (product.image) {
      const media = node('div', 'product-card__media');
      const image = node('img');
      image.src = product.image;
      image.alt = '';
      image.loading = 'lazy';
      image.width = 600;
      image.height = 600;
      media.append(image);
      article.append(media);
    }

    const content = node('div', 'product-card__content');
    const title = node('h3', 'product-card__title');
    const link = node('a', '', product.title);
    link.href = product.url;
    title.append(link);

    const footer = node('div', 'product-card__footer');
    const actions = node('div', 'product-card__actions');

    const save = node('button', 'icon-button');
    save.type = 'button';
    save.dataset.save = '';
    save.dataset.product = JSON.stringify(product);
    save.append(icon('heart'));
    actions.append(save);

    if (product.quickAdd) {
      const form = node('form');
      form.action = strings.cartAddUrl;
      form.method = 'post';
      form.dataset.quickAdd = '';
      form.dataset.handle = product.handle;
      const id = node('input');
      id.type = 'hidden';
      id.name = 'id';
      id.value = product.variant;
      const add = node('button', 'icon-button icon-button--filled');
      add.type = 'submit';
      add.setAttribute('aria-label', text('quickAdd', product.title));
      add.append(icon('plus'));
      form.append(id, add);
      actions.append(form);
    }

    footer.append(node('p', 'product-card__price', product.price), actions);
    content.append(typeLabel(product.type), title, footer);
    article.append(content);
    item.append(article);
    return item;
  }

  // --- Saved gear ---

  // The wishlist button and count appear in the bar and again in the phone menu.
  const savedButtons = [...document.querySelectorAll('[data-saved-open]')];
  const savedCounts = [...document.querySelectorAll('[data-saved-count]')];
  const savedPanel = document.querySelector('[data-saved-panel]');
  const savedList = document.querySelector('[data-saved-list]');
  const savedEmpty = document.querySelector('[data-saved-empty]');

  function syncSaveButtons() {
    const handles = readList(SAVED_KEY).map((product) => product.handle);
    document.querySelectorAll('[data-save]').forEach((button) => {
      const product = JSON.parse(button.dataset.product);
      const saved = handles.includes(product.handle);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', text(saved ? 'unsave' : 'save', product.title));
    });
    savedCounts.forEach((count) => {
      count.textContent = handles.length;
      count.hidden = handles.length === 0;
    });
    savedButtons.forEach((button) => {
      button.setAttribute('aria-label', text('savedButton').replace('[count]', handles.length));
    });
  }

  function renderSaved() {
    if (!savedList) return;
    const saved = readList(SAVED_KEY);
    savedList.replaceChildren(...saved.map(card));
    savedList.hidden = saved.length === 0;
    savedEmpty.hidden = saved.length > 0;
    syncSaveButtons();
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const product = JSON.parse(button.dataset.product);
    const saved = readList(SAVED_KEY);
    const index = saved.findIndex((entry) => entry.handle === product.handle);
    // The wishlist panel covers the page, so a change made inside it is only announced, not shown.
    const insidePanel = savedPanel && savedPanel.contains(button);
    if (index === -1) {
      saved.unshift(product);
      if (insidePanel) announce(text('savedMessage', product.title));
      else showToast(text('savedMessage', product.title), 'saved');
    } else {
      saved.splice(index, 1);
      if (insidePanel) announce(text('unsavedMessage', product.title));
      else showToast(text('unsavedMessage', product.title));
    }
    writeList(SAVED_KEY, saved);
    // Inside the saved panel, keep the card until the panel is reopened so focus is not lost.
    if (savedPanel && savedPanel.contains(button)) syncSaveButtons();
    else renderSaved();
  });

  if (savedPanel && typeof savedPanel.showModal === 'function') {
    savedButtons.forEach((button) => {
      button.hidden = false;
      button.addEventListener('click', () => {
        renderSaved();
        savedPanel.showModal();
      });
    });
    // "View wishlist" in the confirmation message opens the same panel.
    const toastSaved = toast && toast.querySelector('[data-toast-action="saved"]');
    if (toastSaved) {
      toastSaved.addEventListener('click', () => {
        toast.classList.remove('is-visible');
        renderSaved();
        savedPanel.showModal();
      });
    }
    savedPanel.querySelectorAll('[data-saved-close]').forEach((button) => {
      button.addEventListener('click', () => savedPanel.close());
    });
    savedPanel.addEventListener('click', (event) => {
      if (event.target === savedPanel) savedPanel.close();
    });
  }

  // --- Quick add to cart ---

  function updateCartCount(count) {
    document.querySelectorAll('[data-cart-link]').forEach((link) => {
      link.setAttribute('aria-label', text(count === 1 ? 'cartOne' : 'cartOther').replace('[count]', count));
      let badge = link.querySelector('[data-cart-count]');
      if (!badge) {
        badge = node('span', 'header__cart-count');
        badge.dataset.cartCount = '';
        badge.setAttribute('aria-hidden', 'true');
        link.append(badge);
      }
      badge.textContent = count;
    });
    const menuDot = document.querySelector('[data-menu-dot]');
    if (menuDot) menuDot.hidden = count === 0;
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-quick-add]');
    if (!form) return;
    event.preventDefault();

    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const added = await fetch(`${form.action}.js`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      if (!added.ok) throw new Error('Add to cart failed');
      const item = await added.json();
      const cart = await fetch(strings.cartUrl, { headers: { Accept: 'application/json' } }).then((response) =>
        response.json()
      );
      updateCartCount(cart.item_count);
      showToast(text('addedMessage', item.product_title), 'cart');
      reportCartAdd(form.dataset.handle);
      button.classList.add('is-done');
      setTimeout(() => button.classList.remove('is-done'), 1500);
    } catch {
      // Fall back to the normal form post, which opens the cart page.
      form.submit();
    } finally {
      button.disabled = false;
    }
  });

  // --- Recently viewed ---

  const viewNode = document.querySelector('[data-product-view]');
  const currentProduct = viewNode ? JSON.parse(viewNode.textContent) : null;

  document.querySelectorAll('[data-recently-viewed]').forEach((section) => {
    const viewed = readList(VIEWED_KEY).filter((product) => !currentProduct || product.handle !== currentProduct.handle);
    if (viewed.length === 0) return;
    section.querySelector('[data-recently-list]').replaceChildren(...viewed.slice(0, 4).map(card));
    section.hidden = false;
  });

  // --- Picked for you: the last "Tell us about you" results, shown to returning shoppers ---

  document.querySelectorAll('[data-picked-for-you]').forEach((section) => {
    const picks = readList(PICKS_KEY);
    if (picks.length === 0) return;
    section.querySelector('[data-picked-list]').replaceChildren(...picks.slice(0, 4).map(card));
    section.hidden = false;
  });

  if (currentProduct) {
    const viewed = readList(VIEWED_KEY).filter((product) => product.handle !== currentProduct.handle);
    viewed.unshift(currentProduct);
    writeList(VIEWED_KEY, viewed.slice(0, MAX_VIEWED));
  }

  // --- Anonymous suggestion events for the Roam Insights app ---
  // "Tell us about you" announces each submitted result. It is forwarded to the
  // app through Shopify's app proxy. It carries need tags and product handles
  // only. If the app is not installed or the request fails, nothing happens.
  document.addEventListener('roam:suggestions', (event) => {
    const { needs, picks } = event.detail || {};
    if (!Array.isArray(needs) || needs.length === 0) return;
    fetch(strings.eventsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needs, picks }),
      keepalive: true,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        // Kept for this browser tab only, so a later add to cart can be linked to these suggestions.
        if (result && result.eventId) {
          sessionStorage.setItem(SUGGESTION_KEY, JSON.stringify({ eventId: result.eventId, picks, reported: [] }));
        }
      })
      .catch(() => {});
  });

  // Tells the app when a suggested product is added to the cart. Sent once per product.
  function reportCartAdd(handle) {
    try {
      const last = JSON.parse(sessionStorage.getItem(SUGGESTION_KEY));
      if (!last || !handle || !last.picks.includes(handle) || last.reported.includes(handle)) return;
      last.reported.push(handle);
      sessionStorage.setItem(SUGGESTION_KEY, JSON.stringify(last));
      fetch(strings.cartEventUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: last.eventId, handle }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Session storage can be blocked. Shopping still works, the add just is not reported.
    }
  }

  // The product page's own Add to cart form reloads the page, so report as it is submitted.
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-handle]:not([data-quick-add])');
    if (form) reportCartAdd(form.dataset.handle);
  });

  // Other scripts announce when they have drawn new cards (catalog search results).
  document.addEventListener('roam:cards-updated', syncSaveButtons);

  syncSaveButtons();
})();
