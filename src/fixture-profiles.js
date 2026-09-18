import { fileURLToPath } from 'node:url';

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
    releaseVersion: 'checkout-service@2026.08.12-rc3'
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
    releaseVersion: 'inventory-service@2026.08.29-rc1'
  }
};

export function profileForFixture(fixturePath) {
  const name = String(fixturePath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return fixtureProfiles[name] || fixtureProfiles['checkout-service'];
}

export function fixturePathForRepository(repository) {
  return fileURLToPath(new URL(`../fixtures/${repository}`, import.meta.url));
}
