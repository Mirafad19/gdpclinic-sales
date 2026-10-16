export async function gateway(provider, path, { key, body, fetcher = fetch }) {
  if (provider !== 'paystack') throw new Error('Unsupported payment provider');
  const base = 'https://api.paystack.co';
  const response = await fetcher(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok || ![true, 'success'].includes(result.status)) throw new Error('Payment provider is unavailable. Please try again shortly.');
  return result.data;
}

export function matchesPayment(order, payment) {
  return order.provider === 'paystack' && payment.status === 'success'
    && payment.reference === order.reference
    && payment.currency === 'NGN'
    && Number(payment.amount) === order.amount
    && typeof payment.customer?.email === 'string'
    && payment.customer.email.toLowerCase() === order.email.toLowerCase();
}
