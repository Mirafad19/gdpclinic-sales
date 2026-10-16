(() => {
  let catalogue, orders = [];
  const api = async (path, data) => {
    const response = await fetch('/api/' + path, data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Please try again.');
    return result;
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function dialog(title, reader = false) {
    const modal = element('dialog', '', 'clinic-dialog' + (reader ? ' clinic-reader' : ''));
    const close = element('button', '×', 'clinic-close');
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => modal.close();
    const heading = element('h2', title);
    heading.id = 'clinic-heading-' + Math.random().toString(36).slice(2);
    modal.setAttribute('aria-labelledby', heading.id);
    modal.append(close, heading);
    const previousFocus = document.activeElement;
    modal.addEventListener('close', () => { modal.remove(); previousFocus?.focus(); });
    modal.addEventListener('click', e => {
      if (e.target === modal) { const r = modal.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close(); }
    });
    document.body.append(modal);
    modal.showModal();
    return modal;
  }
  const statusNode = modal => {
    const node = element('p', '', 'clinic-status');
    node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    modal.append(node); return node;
  };
  const money = amount => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount / 100);
  async function refresh() {
    const result = await api('library'); orders = result.orders;
    document.querySelectorAll('[data-buy]').forEach(button => {
      const owned = orders.some(o => o.product === button.dataset.buy && o.status === 'paid');
      button.textContent = owned ? 'Read your guide' : 'Get this guide';
    });
  }
  window.clinicCheckout = async id => {
    if (orders.some(o => o.product === id && o.status === 'paid')) return read(id);
    const modal = dialog('Unlock your recovery guide');
    const status = statusNode(modal);
    try {
      catalogue ||= await api('catalog');
      const product = catalogue.products.find(p => p.id === id);
      if (!product) throw new Error('Guide not found.');
      modal.insertBefore(element('p', product.title), status);
      modal.insertBefore(element('h3', money(product.amount)), status);
      if (!product.available) throw new Error('This guide is being prepared. Please contact the clinic for availability. You have not been charged.');
      if (!catalogue.providers.includes('paystack')) throw new Error('Online payments are not available yet. Please contact the clinic.');
      const form = element('form');
      const label = element('label', 'Your email address'); label.htmlFor = 'clinic-email';
      const email = element('input'); email.type = 'email'; email.id = 'clinic-email'; email.required = true; email.maxLength = 254; email.autocomplete = 'email'; email.placeholder = 'you@example.com';
      const submit = element('button', `Pay ${money(product.amount)} with Paystack`, 'btn btn-primary'); submit.type = 'submit';
      form.append(label, email, element('p', 'You’ll return here after payment to read every module. Your receipt is sent to this email. Keep using this browser to access your guides.'), submit);
      modal.insertBefore(form, status);
      email.focus();
      form.onsubmit = async event => {
        event.preventDefault(); submit.disabled = true; status.textContent = 'Opening secure Paystack checkout…';
        try {
          const result = await api('checkout', { product: id, provider: 'paystack', email: email.value.trim() });
          if (result.unlocked) { await refresh(); modal.close(); return read(id); }
          location.assign(result.url);
        } catch (error) { status.textContent = error.message; submit.disabled = false; }
      };
    } catch (error) { status.textContent = error.message; }
  };
  async function confirm(reference, status, button) {
    if (button) button.disabled = true;
    status.textContent = 'Confirming payment with Paystack…';
    try {
      const result = await api('verify', { reference });
      if (!result.paid) { status.textContent = 'Payment is not confirmed yet. If you paid, please wait a moment and check again. Your guide remains locked.'; return null; }
      await refresh(); status.textContent = 'Payment confirmed. Your guide is unlocked.'; return result.product;
    } catch (error) { status.textContent = error.message; return null; }
    finally { if (button) button.disabled = false; }
  }
  async function library() {
    const modal = dialog('My recovery guides');
    const status = statusNode(modal);
    try {
      await refresh(); catalogue ||= await api('catalog');
      if (!orders.length) status.textContent = 'Your purchased guides will appear here. Already paid in another browser? Contact the clinic with your receipt.';
      for (const order of orders) {
        const row = element('div', '', 'clinic-book');
        const title = catalogue.products.find(p => p.id === order.product)?.title || order.product;
        const text = element('div'); text.append(element('strong', title), element('p', order.status === 'paid' ? 'Unlocked · All modules' : 'Payment not yet confirmed'));
        const button = element('button', order.status === 'paid' ? 'Read guide' : 'Check payment');
        button.onclick = async () => {
          const id = order.status === 'paid' ? order.product : await confirm(order.reference, status, button);
          if (id) { modal.close(); await read(id); }
        };
        row.append(text, button); modal.insertBefore(row, status);
      }
    } catch (error) { status.textContent = error.message; }
  }
  async function read(id) {
    const modal = dialog('Your recovery guide', true);
    const status = statusNode(modal);
    try {
      const book = await api('guides/' + encodeURIComponent(id));
      modal.querySelector('h2').textContent = book.title;
      const progress = element('p', '', 'clinic-progress');
      const layout = element('div', '', 'clinic-reader-layout');
      const nav = element('nav', '', 'clinic-module-list'); nav.setAttribute('aria-label', 'Guide modules');
      const article = element('article', '', 'clinic-module-body');
      let current = 0;
      try { current = Number(localStorage.getItem('clinic-progress-' + id)) || 0; } catch {}
      current = Math.max(0, Math.min(book.modules.length - 1, current));
      const buttons = book.modules.map((module, i) => {
        const button = element('button', `${i + 1}. ${module.title}`); button.onclick = () => show(i); nav.append(button); return button;
      });
      function show(index) {
        current = index;
        try { localStorage.setItem('clinic-progress-' + id, String(index)); } catch {}
        progress.textContent = `Module ${index + 1} of ${book.modules.length}`;
        buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
        article.replaceChildren(element('h3', book.modules[index].title));
        book.modules[index].paragraphs.forEach(text => article.append(element('p', text)));
        const controls = element('div', '', 'clinic-next');
        const previous = element('button', '← Previous', 'btn'); previous.disabled = index === 0; previous.onclick = () => show(index - 1);
        const next = element('button', index === book.modules.length - 1 ? 'Last module' : 'Next module →', 'btn btn-primary'); next.disabled = index === book.modules.length - 1; next.onclick = () => show(index + 1);
        controls.append(previous, next); article.append(controls);
      }
      layout.append(nav, article); modal.insertBefore(progress, status); modal.insertBefore(layout, status); show(current);
    } catch (error) { status.textContent = error.message; }
  }
  const libraryButton = element('button', 'My guides', 'clinic-library-button');
  libraryButton.onclick = library;
  document.getElementById('guidesGrid').before(libraryButton);
  async function init() {
    try {
      // Establish the browser's purchase session before enabling simultaneous API calls.
      await refresh();
      const params = new URLSearchParams(location.search);
      const reference = params.get('payment');
      if (!reference) return;
      const modal = dialog('Confirm your payment'); const status = statusNode(modal);
      const button = element('button', 'Check payment again', 'btn btn-primary'); modal.append(button);
      const check = async () => { const id = await confirm(reference, status, button); if (id) { history.replaceState({}, '', '/#/guides'); modal.close(); await read(id); } };
      button.onclick = check; await check();
    } catch { /* Checkout presents connection errors when requested. */ }
  }
  init();
})();
