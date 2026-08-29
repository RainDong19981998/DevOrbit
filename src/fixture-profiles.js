import { fileURLToPath } from 'node:url';

const FIXED_STOCK = `const stockBySku = new Map();

export function resetStock(initial = {}) {
  stockBySku.clear();
  for (const [sku, quantity] of Object.entries(initial)) stockBySku.set(sku, quantity);
}

export function getStock(sku) {
  return stockBySku.get(sku) ?? 0;
}

export function deductStock({ sku, quantity }) {
  const current = stockBySku.get(sku) ?? 0;
  if (current < quantity) return { status: 409, remaining: current, reason: 'insufficient-stock' };
  stockBySku.set(sku, current - quantity);
  return { status: 200, remaining: current - quantity };
}
`;

export const fixtureProfiles = {
  'checkout-service': {
    repository: 'checkout-service',
    tenant: 'acme-commerce',
    service: 'checkout-service',
    environment: 'production',
    gitRevision: 'a1b2c3d4',
    services: ['checkout-web', 'checkout-service', 'idempotency-store'],
    endpoints: ['POST /orders', 'POST /payments'],
    usersImpact: '约 7.4% 下单请求',
    sourceFiles: ['src/order.js', 'src/redisPool.js'],
    files: ['src/order.js', 'src/redisPool.js', 'test/order.test.js', 'test/redisPool.test.js'],
    regressionTests: ['test/order.test.js', 'test/redisPool.test.js'],
    tags: ['checkout', 'redis', 'idempotency'],
    topology: [
      { from: 'checkout-web', to: 'checkout-service', type: 'http' },
      { from: 'checkout-service', to: 'idempotency-store', type: 'redis' }
    ],
    releaseVersion: 'checkout-service@2026.08.12-rc3',
    pattern: '连接池缩容 + 幂等重试放大',
    rootCause: {
      statement: '连接池容量从 80 缩减为 8 造成幂等存储排队超时，重试路径未复用已创建订单。',
      evidence: ['CHG-402', 'LOG-10A', 'METRIC-55', 'repo://src/redisPool.js'],
      runnerUp: [
        { statement: '支付调用超时阈值与订单重试策略不一致，可能放大尾延迟。', score: 0.58, evidence: ['ISSUE-771'] },
        { statement: '网关 502 是下游超时结果，不是首因。', score: 0.31, evidence: ['METRIC-55'] }
      ]
    }
  },
  'inventory-service': {
    repository: 'inventory-service',
    tenant: 'acme-commerce',
    service: 'inventory-service',
    environment: 'production',
    gitRevision: 'e5f6a7b8',
    services: ['inventory-web', 'inventory-service', 'stock-ledger-db'],
    endpoints: ['POST /stock/deduct', 'GET /stock/query'],
    usersImpact: '约 1.2% 秒杀订单超卖',
    sourceFiles: ['src/stock.js'],
    files: ['src/stock.js', 'test/stock.test.js'],
    regressionTests: ['test/stock.test.js'],
    tags: ['inventory', 'oversell', 'concurrency'],
    topology: [
      { from: 'inventory-web', to: 'inventory-service', type: 'http' },
      { from: 'inventory-service', to: 'stock-ledger-db', type: 'sql' }
    ],
    releaseVersion: 'inventory-service@2026.08.29-rc1',
    pattern: '乐观锁缺失 + 并发扣减超卖',
    rootCause: {
      statement: '库存扣减路径缺少非负校验（乐观锁条件被移除），并发扣减导致超卖与台账负库存。',
      evidence: ['CHG-501', 'LOG-20A', 'METRIC-61', 'DB-77', 'repo://src/stock.js'],
      runnerUp: [
        { statement: '缓存扣减与数据库台账双写不一致，缓存层可能掩盖超卖。', score: 0.52, evidence: ['LOG-20A'] },
        { statement: '秒杀流量突增超出容量，需要先限流。', score: 0.34, evidence: ['METRIC-61'] }
      ]
    },
    fix: {
      summary: '恢复库存扣减非负校验：余量不足时拒绝并返回 409，消除并发超卖与台账负库存。',
      diff: '- stockBySku.set(sku, current - quantity)\n+ if (current < quantity) return { status: 409, remaining: current, reason: \'insufficient-stock\' }\n+ stockBySku.set(sku, current - quantity)',
      files: [{ path: 'src/stock.js', fixed: FIXED_STOCK }]
    }
  }
};

export function profileForFixture(fixturePath) {
  const name = String(fixturePath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return fixtureProfiles[name] || fixtureProfiles['checkout-service'];
}

export function fixturePathForRepository(repository) {
  return fileURLToPath(new URL(`../fixtures/${repository}`, import.meta.url));
}
