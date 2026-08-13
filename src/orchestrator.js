import { DeliveryManager } from './runtime/manager.js';
import { createHttpProvidersFromEnv } from './adapters/http.js';

const envProviders = createHttpProvidersFromEnv();

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

export function getDemoCase() {
  return structuredClone(demoCase);
}

export async function runPipeline(input = {}) {
  const { scenario = 'happy-path', approvalState = 'approved', controls = {}, signals, ...incidentOverrides } = input;
  const incident = { ...demoCase, ...incidentOverrides, signals: signals || demoCase.signals };
  const manager = new DeliveryManager({ incident, scenario, approvalState, controls, providers: envProviders || {} });
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
