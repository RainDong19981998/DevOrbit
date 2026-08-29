const stockBySku = new Map();

export function resetStock(initial = {}) {
  stockBySku.clear();
  for (const [sku, quantity] of Object.entries(initial)) stockBySku.set(sku, quantity);
}

export function getStock(sku) {
  return stockBySku.get(sku) ?? 0;
}

export function deductStock({ sku, quantity }) {
  const current = stockBySku.get(sku) ?? 0;
  stockBySku.set(sku, current - quantity);
  return { status: 200, remaining: current - quantity };
}
