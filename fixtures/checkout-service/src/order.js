const ordersByKey = new Map();

export function resetOrders() {
  ordersByKey.clear();
}

export function createOrder({ idempotencyKey, payload }) {
  const order = { id: `ORD-${ordersByKey.size + 1}`, payload };
  ordersByKey.set(idempotencyKey, order);
  return { status: 201, order };
}
