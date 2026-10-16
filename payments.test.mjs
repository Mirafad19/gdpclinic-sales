import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesPayment } from './payments.mjs';

const order = { provider: 'paystack', reference: 'gdp_test', amount: 850000, email: 'buyer@example.com' };
const payment = { status: 'success', reference: 'gdp_test', amount: 850000, currency: 'NGN', customer: { email: 'buyer@example.com' } };
test('verification requires status, reference, exact amount, currency and payer email', () => {
  assert.equal(matchesPayment(order, payment), true);
  for (const altered of [{ status: 'pending' }, { status: 'failed' }, { reference: 'other' }, { amount: 8500 }, { amount: 850001 }, { currency: 'USD' }, { customer: { email: 'other@example.com' } }, { customer: null }]) {
    assert.equal(matchesPayment(order, { ...payment, ...altered }), false);
  }
});

test('full checkout enforces price, verified access, session ownership and persistence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gdp-test-'));
  process.env.DATABASE_PATH = join(directory, 'test.sqlite');
  process.env.CONTENT_DIR = directory;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_mock_not_a_real_key';
  process.env.PUBLIC_URL = 'http://localhost:3000';
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  const products = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
  writeFileSync(join(directory, 'desk-guide.json'), JSON.stringify({ modules: products[0].modules.map(title => ({ title, paragraphs: ['Test fixture only. Not clinical advice.'] })) }));
  const realFetch = globalThis.fetch;
  let sent, verified, calls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.paystack.co')) return realFetch(url, options);
    calls++;
    if (url.endsWith('/initialize')) {
      sent = JSON.parse(options.body);
      return Response.json({ status: true, data: { authorization_url: 'https://checkout.paystack.com/mock' } });
    }
    return Response.json({ status: true, data: verified });
  };
  const { server } = await import('./server.mjs');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function call(path, data, browserCookie = cookie) {
    return realFetch(base + path, { method: data ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000', ...(browserCookie ? { Cookie: browserCookie } : {}), 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  }
  try {
    const catalogue = await call('/api/catalog');
    cookie = catalogue.headers.get('set-cookie').split(';')[0];
    assert.match(catalogue.headers.get('set-cookie'), /HttpOnly/);
    const catalogueData = await catalogue.json();
    assert.equal(catalogueData.products[0].available, true);
    assert.equal(catalogueData.products[1].available, false);
    assert.equal((await call('/api/guides/desk-guide')).status, 403);
    assert.equal((await call('/content/desk-guide.json')).status, 404);
    assert.equal((await call('/.env')).status, 404);
    const unavailable = await call('/api/checkout', { product: 'back-blueprint', provider: 'paystack', email: order.email });
    assert.equal(unavailable.status, 409);
    assert.equal(calls, 0);
    const checkout = await call('/api/checkout', { product: 'desk-guide', provider: 'paystack', email: order.email, amount: 1 });
    assert.equal(checkout.status, 200);
    const { reference } = await checkout.json();
    assert.equal(sent.amount, 850000);
    assert.equal(sent.reference, reference);
    assert.match(sent.callback_url, /payment=gdp_/);
    // Forging the success callback cannot grant access.
    await call(`/?payment=${reference}&status=success`);
    assert.equal((await call('/api/guides/desk-guide')).status, 403);
    verified = { ...payment, reference, amount: 1 };
    assert.equal((await (await call('/api/verify', { reference })).json()).paid, false);
    assert.equal((await call('/api/guides/desk-guide')).status, 403);
    verified = { ...payment, reference };
    assert.equal((await (await call('/api/verify', { reference })).json()).paid, true);
    const book = await (await call('/api/guides/desk-guide')).json();
    assert.equal(book.modules.length, 6);
    const previousCalls = calls;
    assert.equal((await (await call('/api/verify', { reference })).json()).paid, true);
    assert.equal(calls, previousCalls, 'paid verification is idempotent');
    assert.equal((await call('/api/guides/desk-guide', undefined, '')).status, 403);
    assert.equal((await call('/api/verify', { reference }, '')).status, 404);
    const badOrigin = await realFetch(base + '/api/checkout', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: '{}' });
    assert.equal(badOrigin.status, 403);
    const { DatabaseSync } = await import('node:sqlite');
    const persisted = new DatabaseSync(process.env.DATABASE_PATH);
    assert.equal(persisted.prepare('SELECT status FROM orders WHERE reference=?').get(reference).status, 'paid');
    persisted.close();
  } finally {
    globalThis.fetch = realFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
