import { DeliveryManager } from './runtime/manager.js';
import { createHttpProvidersFromEnv } from './adapters/http.js';
import { createNativePlatformProvidersFromEnv } from './adapters/platforms.js';
import { fixturePathForRepository } from './fixture-profiles.js';

const envProviders = createNativePlatformProvidersFromEnv() || createHttpProvidersFromEnv();

const demoCase = {
  title: '支付页提交后持续转圈，订单偶发重复创建',
  repository: 'checkout-service',
  branch: 'release/2026.08',
  signals: [
    { source: '用户反馈', id: 'FB-1842', text: '10:15 后支付页一直转圈，刷新后出现两笔订单', time: '10:15:09' },
    { source: 'Issue', id: 'ISSUE-771', text: '订单创建接口偶发 502，重试后成功', time: '10:15:21' },
    { source: '日志', id: 'LOG-10A', text: 'IdempotencyStore timeout after 3000ms; retrying request', time: '10:15:24' },
    { source: '指标', id: 'METRIC-55', text: 'POST /orders p95 420ms -> 2.8s; error rate 0.2% -> 7.4%', time: '10:15:30' },
    { source: '变更', id: 'CHG-402', text: 'redis.client.poolSize changed 80 -> 8 in release/2026.08', time: '10:02:11' }
  ]
};

const inventoryCase = {
  title: '秒杀活动库存超卖，台账出现负库存',
  repository: 'inventory-service',
  branch: 'release/2026.08',
  signals: [
    { source: '用户反馈', id: 'FB-2210', text: '14:05 秒杀下单成功后被取消，提示库存不足', time: '14:05:41' },
    { source: 'Issue', id: 'ISSUE-832', text: '同一 SKU 售出数量超过活动库存，出现超卖工单', time: '14:06:02' },
    { source: '日志', id: 'LOG-20A', text: 'inventory-cache DECR ok qps=310 hit-rate=99.2%; deduct API success', time: '14:05:12' },
    { source: '指标', id: 'METRIC-61', text: 'POST /stock/deduct success rate 99.9%; p95 88ms', time: '14:05:20' },
    { source: '变更', id: 'CHG-501', text: 'inventory-service v2026.08.29 removed optimistic-lock condition: UPDATE stock SET qty = qty - ? WHERE sku = ? AND qty >= ?', time: '13:40:02' },
    { source: '数据库', id: 'DB-77', text: 'stock_ledger.qty negative rows detected: SKU-C=-1, SKU-D=-3', time: '14:06:41' }
  ]
};

export function getDemoCase() {
  return structuredClone(demoCase);
}

export function getInventoryCase() {
  return structuredClone(inventoryCase);
}

export function getCaseForFixture(fixture) {
  return fixture === 'inventory' ? getInventoryCase() : getDemoCase();
}

export async function runPipeline(input = {}) {
  const { scenario = 'happy-path', approvalState = 'approved', controls = {}, signals, fixture, ...incidentOverrides } = input;
  const baseCase = fixture === 'inventory' ? inventoryCase : demoCase;
  const incident = { ...baseCase, ...incidentOverrides, signals: signals || baseCase.signals };
  const manager = new DeliveryManager({ incident, scenario, approvalState, controls, providers: envProviders || {}, fixturePath: fixturePathForRepository(incident.repository) });
  try {
    const result = await manager.run();
    if (result.state.status !== 'approval_pending') return result;
    await manager.disposeWorkspace();
    return manager.result();
  } catch (error) {
    await manager.disposeWorkspace().catch(() => {});
    throw error;
  }
}
