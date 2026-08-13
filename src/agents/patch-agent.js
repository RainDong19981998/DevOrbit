import { mergeArtifact, transition } from '../runtime/case-state.js';
import { digest } from '../runtime/digest.js';
import { recordTrace } from '../runtime/trace.js';

const fixedPool = `export const redisPoolConfig = {\n  poolSize: 80,\n  queueTimeoutMs: 800\n};\n`;
const fixedOrder = `const ordersByKey = new Map();\n\nexport function resetOrders() {\n  ordersByKey.clear();\n}\n\nexport function createOrder({ idempotencyKey, payload }) {\n  const existing = ordersByKey.get(idempotencyKey);\n  if (existing) return { status: 409, order: existing };\n  const order = { id: \`ORD-\${ordersByKey.size + 1}\`, payload };\n  ordersByKey.set(idempotencyKey, order);\n  return { status: 201, order };\n}\n`;

export const patchAgent = {
  id: 'patch-worker',
  skill: 'PatchPlan',
  async execute(state, context) {
    const workspaceId = `WS-${state.case_id}`;
    const created = await context.mcp.callTool('repository.create_workspace', { workspaceId, idempotencyKey: `${state.case_id}:workspace` });
    const beforePool = await context.mcp.callTool('repository.read_file', { workspaceId, path: 'src/redisPool.js' });
    const beforeOrder = await context.mcp.callTool('repository.read_file', { workspaceId, path: 'src/order.js' });
    const baseline = await context.mcp.callTool('ci.run_tests', { workspaceId, idempotencyKey: `${state.case_id}:baseline-tests` });
    const poolWrite = await context.mcp.callTool('repository.write_file', { workspaceId, path: 'src/redisPool.js', content: fixedPool, idempotencyKey: `${state.case_id}:write:redisPool` });
    let orderWrite = null;
    if (state.scenario !== 'test-failure') orderWrite = await context.mcp.callTool('repository.write_file', { workspaceId, path: 'src/order.js', content: fixedOrder, idempotencyKey: `${state.case_id}:write:order` });
    const baselineTests = baseline.data;
    const patch = {
      workspaceId,
      summary: '恢复连接池容量、延长排队超时并在重试路径复用原订单。',
      files: ['src/redisPool.js', 'src/order.js'],
      patch: '- poolSize: 8\n+ poolSize: 80\n- queueTimeoutMs: 250\n+ queueTimeoutMs: 800\n+ duplicate request → 409 + original order',
      rollbackRef: `sha256:${digest(beforePool.data.content + beforeOrder.data.content)}`,
      patchDigest: `sha256:${digest(fixedPool + (state.scenario === 'test-failure' ? beforeOrder.data.content : fixedOrder))}`,
      baselineTests,
      mcpCalls: [created.call, beforePool.call, beforeOrder.call, baseline.call, poolWrite.call, orderWrite?.call].filter(Boolean),
      risk: 'L2（灰度 + 审批）'
    };
    mergeArtifact(state, 'plan', patch);
    state.risk_level = 'L2';
    transition(state, 'planned', 'minimal patch applied to isolated workspace');
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'patch', parentSpanId: context.parentSpanId, message: `经 MCP 工具在隔离工作区复现 ${baselineTests.failed} 个失败，并应用最小补丁。`, evidence: [`baseline-ci://${baselineTests.artifact}`, `patch://${patch.patchDigest}`, `rollback://${patch.rollbackRef}`, `mcp://workspace/${workspaceId}`], input: state.artifacts.rca, output: patch });
    return patch;
  }
};
