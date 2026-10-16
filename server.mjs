import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openStore } from './storage.mjs';
import { gateway, matchesPayment } from './payments.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const products = JSON.parse(readFileSync(join(root, 'catalog.json')));
const origin = new URL(process.env.PUBLIC_URL || 'http://localhost:3000').origin;
const secure = origin.startsWith('https:');
let store;
const getStore = () => store ||= openStore(root).catch(error => { store = null; throw error; });
const keyFor = () => process.env.PAYSTACK_SECRET_KEY;
const providers = () => keyFor() ? ['paystack'] : [];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

function content(product) {
  const path = join(process.env.CONTENT_DIR || join(root, 'content'), `${product.id}.json`);
  if (!existsSync(path)) return null;
  try {
    const book = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(book.modules) || book.modules.length !== product.modules.length) return null;
    if (!book.modules.every(m => typeof m.title === 'string' && Array.isArray(m.paragraphs) && m.paragraphs.length && m.paragraphs.every(p => typeof p === 'string' && p.trim()))) return null;
    return book;
  } catch { return null; }
}

async function body(req) {
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 8192) throw fail(413, 'Request is too large.');
    if (typeof req.body === 'object' && req.body !== null) return req.body;
    try { return JSON.parse(req.body); } catch { throw fail(400, 'Invalid request.'); }
  }
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 8192) throw fail(413, 'Request is too large.');
  }
  try { return JSON.parse(data); } catch { throw fail(400, 'Invalid request.'); }
}

async function verify(order) {
  const db = await getStore();
  if (order.status === 'paid') return true;
  if (!keyFor(order.provider)) throw fail(503, 'Payment verification is temporarily unavailable.');
  const path = `/transaction/verify/${encodeURIComponent(order.reference)}`;
  const payment = await gateway(order.provider, path, { key: keyFor(order.provider) });
  if (!matchesPayment(order, payment)) return false;
  (await db.prepare("UPDATE orders SET status='paid' WHERE reference=?").run(order.reference));
  return true;
}

const limits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
}, 60000).unref();

export async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  try {
    const url = new URL(req.url, origin);
    const staticFiles = { '/': ['index.html', 'text/html'], '/checkout.js': ['checkout.js', 'text/javascript'], '/checkout.css': ['checkout.css', 'text/css'] };
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      return res.end(readFileSync(join(root, 'public', file)));
    }
    if (!url.pathname.startsWith('/api/')) throw fail(404, 'Page not found.');
    if (process.env.VERCEL && (!process.env.PUBLIC_URL || !secure)) throw fail(503, 'The clinic checkout is not configured yet. Please contact the clinic.');
    if (req.method === 'POST' && req.headers.origin !== origin) throw fail(403, 'Please make this request from the clinic website.');
    const db = await getStore();
    const now = Date.now();
    const ip = req.socket.remoteAddress;
    let bucket = limits.get(ip);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60000 }; limits.set(ip, bucket); }
    if (++bucket.count > 100) throw fail(429, 'Too many requests. Please wait a minute.');
    const cookie = /(?:^|;\s*)clinic_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    let session = cookie && hash(cookie[1]);
    if (!session || !(await db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(session, now))) {
      const token = randomBytes(32).toString('hex');
      session = hash(token);
      (await db.prepare('INSERT INTO sessions VALUES (?, ?)').run(session, now + 365 * 86400000));
      res.setHeader('Set-Cookie', `clinic_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`);
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return json(200, { providers: providers(), products: products.map(({ id, title, amount, modules }) => ({ id, title, amount, modules, available: Boolean(content(products.find(p => p.id === id))) })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/library') {
      const orders = (await db.prepare('SELECT reference,product,status FROM orders WHERE session=? ORDER BY created DESC LIMIT 100').all(session));
      return json(200, { orders });
    }
    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      const input = await body(req);
      const p = products.find(p => p.id === input.product);
      if (!p || !providers().includes(input.provider)) throw fail(400, 'Select an available guide and payment provider.');
      if (!content(p)) throw fail(409, 'This guide is not available for purchase yet. Please contact the clinic.');
      if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw fail(400, 'Enter a valid email address.');
      if ((await db.prepare("SELECT reference FROM orders WHERE session=? AND product=? AND status='paid'").get(session, p.id))) return json(200, { unlocked: true, product: p.id });
      const recent = (await db.prepare('SELECT count(*) AS n FROM orders WHERE session=? AND created>?').get(session, now - 3600000));
      if (recent.n >= 20) throw fail(429, 'Please wait before starting another payment.');
      const reference = `gdp_${randomBytes(20).toString('hex')}`;
      const email = input.email.trim().toLowerCase();
      const provider = input.provider;
      (await db.prepare('INSERT INTO orders (reference,session,product,provider,email,amount,created) VALUES (?,?,?,?,?,?,?)').run(reference, session, p.id, provider, email, p.amount, now));
      const callback = `${origin}/?payment=${reference}#/guides`;
      const payload = { email, amount: p.amount, currency: 'NGN', reference, callback_url: callback, metadata: { product_id: p.id } };
      const result = await gateway(provider, '/transaction/initialize', { key: keyFor(provider), body: payload });
      const checkout = new URL(result.authorization_url);
      if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.paystack.com') throw fail(502, 'Invalid checkout link from payment provider.');
      return json(200, { url: checkout.href, reference });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') {
      const input = await body(req);
      if (typeof input.reference !== 'string') throw fail(400, 'Payment reference is required.');
      const order = (await db.prepare('SELECT * FROM orders WHERE reference=? AND session=?').get(input.reference, session));
      if (!order) throw fail(404, 'Payment not found in this browser. Contact the clinic with your receipt.');
      return json(200, { paid: await verify(order), product: order.product });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/guides/')) {
      const id = url.pathname.slice('/api/guides/'.length);
      if (!(await db.prepare("SELECT reference FROM orders WHERE session=? AND product=? AND status='paid'").get(session, id))) throw fail(403, 'Purchase this guide to read its modules.');
      const p = products.find(p => p.id === id);
      const book = p && content(p);
      if (!book) throw fail(503, 'Your guide is temporarily unavailable. Please contact the clinic.');
      return json(200, { title: p.title, modules: book.modules });
    }
    throw fail(404, 'Page not found.');
  } catch (error) {
    json(error.status || 502, { error: error.status ? error.message : 'Unable to contact the payment provider. Your guide stays locked until payment is confirmed. Please retry verification from My guides.' });
  }
}

export const server = http.createServer(handler);
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`GDP Clinic: ${origin}`));
