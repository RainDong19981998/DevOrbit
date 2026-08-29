import { mergeArtifact, transition } from '../runtime/case-state.js';
import { digest } from '../runtime/digest.js';
import { recordTrace } from '../runtime/trace.js';

const MAX_PATCH_ATTEMPTS = 3;

const FIXED_POOL = `export const redisPoolConfig = {\n  poolSize: 80,\n  queueTimeoutMs: 800\n};\n`;
const FIXED_ORDER = `const ordersByKey = new Map();\n\nexport function resetOrders() {\n  ordersByKey.clear();\n}\n\nexport function createOrder({ idempotencyKey, payload }) {\n  const existing = ordersByKey.get(idempotencyKey);\n  if (existing) return { status: 409, order: existing };\n  const order = { id: \`ORD-\${ordersByKey.size + 1}\`, payload };\n  ordersByKey.set(idempotencyKey, order);\n  return { status: 201, order };\n}\n`;

const PARTIAL_POOL = `export const redisPoolConfig = {\n  poolSize: 40,\n  queueTimeoutMs: 800\n};\n`;

function isSelfHealingScenario(state) {
  return state.scenario === 'self-healing' || state.scenario === 'circuit-breaker';
}

export const patchAgent = {
  id: 'patch-worker',
  skill: 'PatchPlan',
  async execute(state, context) {
    if (context.profile?.fix) return this.applyProfileFix(state, context);
    const priorPlan = state.artifacts.plan;
    const isRework = Boolean(priorPlan);
    const attempt = (priorPlan?.attempts || 0) + 1;
    const maxAttempts = context.controls.maxPatchAttempts ?? MAX_PATCH_ATTEMPTS;
    const tests = state.artifacts.tests;
    const failureFeedback = tests?.gate === 'failed' ? { outputTail: tests.outputTail, failed: tests.failed, passed: tests.passed } : null;

    let workspaceId = priorPlan?.workspaceId;
    let baseCommit = priorPlan?.baseCommit || null;
    if (!workspaceId) {
      workspaceId = `WS-${state.case_id}`;
      const created = await context.mcp.callTool('repository.create_workspace', { workspaceId, idempotencyKey: `${state.case_id}:workspace` });
      if (created.data.baseCommit) baseCommit = created.data.baseCommit;
    }
    const beforePool = await context.mcp.callTool('repository.read_file', { workspaceId, path: 'src/redisPool.js' });
    const beforeOrder = await context.mcp.callTool('repository.read_file', { workspaceId, path: 'src/order.js' });
    const baseline = priorPlan?.baselineTests || await context.mcp.callTool('ci.run_tests', { workspaceId, idempotencyKey: `${state.case_id}:baseline-tests-${attempt}` });

    const usePartialFix = state.scenario === 'circuit-breaker' || (isSelfHealingScenario(state) && attempt === 1);
    const skipOrder = state.scenario === 'test-failure' || state.scenario === 'circuit-breaker';
    const poolContent = usePartialFix ? (isSelfHealingScenario(state) ? PARTIAL_POOL : FIXED_POOL) : FIXED_POOL;
    const orderContent = skipOrder ? beforeOrder.data.content : FIXED_ORDER;

    const poolWrite = await context.mcp.callTool('repository.write_file', { workspaceId, path: 'src/redisPool.js', content: poolContent, idempotencyKey: `${state.case_id}:write:redisPool:${attempt}` });
    let orderWrite = null;
    if (!skipOrder) orderWrite = await context.mcp.callTool('repository.write_file', { workspaceId, path: 'src/order.js', content: orderContent, idempotencyKey: `${state.case_id}:write:order:${attempt}` });

    const baselineTests = baseline.data || baseline;
    const patch = {
      workspaceId,
      baseCommit,
      branch: priorPlan?.branch || state.incident.branch || null,
      attempts: attempt,
      maxAttempts,
      isRework,
      failureFeedback,
      summary: isRework ? `第 ${attempt} 次返工：${failureFeedback ? `分析失败日志（${failureFeedback.failed} 项失败）后` : ''}修正补丁，恢复连接池容量并补全幂等保护。` : '恢复连接池容量、延长排队超时并在重试路径复用原订单。',
      files: skipOrder ? ['src/redisPool.js'] : ['src/redisPool.js', 'src/order.js'],
      patch: skipOrder ? '- poolSize: 8\n+ poolSize: 80\n- queueTimeoutMs: 250\n+ queueTimeoutMs: 800' : '- poolSize: 8\n+ poolSize: 80\n- queueTimeoutMs: 250\n+ queueTimeoutMs: 800\n+ duplicate request → 409 + original order',
      rollbackRef: `sha256:${digest(beforePool.data.content + beforeOrder.data.content)}`,
      patchDigest: `sha256:${digest(poolContent + orderContent)}`,
      baselineTests,
      mcpCalls: [poolWrite.call, orderWrite?.call].filter(Boolean),
      risk: 'L2（灰度 + 审批）'
    };
    mergeArtifact(state, 'plan', patch);
    state.risk_level = 'L2';
    transition(state, 'planned', isRework ? `rework attempt ${attempt}/${maxAttempts} applied after test failure` : 'minimal patch applied to isolated workspace');
    recordTrace(state, {
      agent: this.id,
      skill: this.skill,
      stage: 'patch',
      parentSpanId: context.parentSpanId,
      message: isRework
        ? `第 ${attempt} 次返工：${failureFeedback ? `读取失败日志（${failureFeedback.outputTail?.slice(0, 80) || ''}…），` : ''}${usePartialFix ? '仅恢复连接池至 poolSize=40（仍不满足≥64），预期测试仍失败' : '补全幂等保护逻辑，恢复 poolSize=80。'}`
        : `经 MCP 工具在隔离工作区复现 ${baselineTests.failed} 个失败，并应用最小补丁。`,
      evidence: [`baseline-ci://${baselineTests.artifact}`, `patch://${patch.patchDigest}`, `rollback://${patch.rollbackRef}`, `mcp://workspace/${workspaceId}`, ...(patch.baseCommit ? [`git://${patch.baseCommit}`] : []), ...(isRework ? [`rework://${attempt}/${maxAttempts}`] : [])],
      input: { rca: state.artifacts.rca, failureFeedback },
      output: patch
    });
    return patch;
  },
  async applyProfileFix(state, context) {
    const profile = context.profile;
    const priorPlan = state.artifacts.plan;
    const isRework = Boolean(priorPlan);
    const attempt = (priorPlan?.attempts || 0) + 1;
    const maxAttempts = context.controls.maxPatchAttempts ?? MAX_PATCH_ATTEMPTS;
    const tests = state.artifacts.tests;
    const failureFeedback = tests?.gate === 'failed' ? { outputTail: tests.outputTail, failed: tests.failed, passed: tests.passed } : null;

    let workspaceId = priorPlan?.workspaceId;
    let baseCommit = priorPlan?.baseCommit || null;
    if (!workspaceId) {
      workspaceId = `WS-${state.case_id}`;
      const created = await context.mcp.callTool('repository.create_workspace', { workspaceId, idempotencyKey: `${state.case_id}:workspace` });
      if (created.data.baseCommit) baseCommit = created.data.baseCommit;
    }
    const beforeContents = [];
    for (const file of profile.fix.files) {
      const before = await context.mcp.callTool('repository.read_file', { workspaceId, path: file.path });
      beforeContents.push(before.data.content);
    }
    const baseline = priorPlan?.baselineTests || await context.mcp.callTool('ci.run_tests', { workspaceId, idempotencyKey: `${state.case_id}:baseline-tests-${attempt}` });
    const writes = [];
    for (const file of profile.fix.files) {
      writes.push(await context.mcp.callTool('repository.write_file', { workspaceId, path: file.path, content: file.fixed, idempotencyKey: `${state.case_id}:write:${file.path}:${attempt}` }));
    }

    const baselineTests = baseline.data || baseline;
    const patch = {
      workspaceId,
      baseCommit,
      branch: priorPlan?.branch || state.incident.branch || null,
      attempts: attempt,
      maxAttempts,
      isRework,
      failureFeedback,
      summary: profile.fix.summary,
      files: profile.fix.files.map(file => file.path),
      patch: profile.fix.diff,
      rollbackRef: `sha256:${digest(beforeContents.join('\n'))}`,
      patchDigest: `sha256:${digest(profile.fix.files.map(file => file.fixed).join('\n'))}`,
      baselineTests,
      mcpCalls: writes.map(write => write.call),
      risk: 'L2（灰度 + 审批）'
    };
    mergeArtifact(state, 'plan', patch);
    state.risk_level = 'L2';
    transition(state, 'planned', isRework ? `rework attempt ${attempt}/${maxAttempts} applied after test failure` : 'minimal patch applied to isolated workspace');
    recordTrace(state, {
      agent: this.id,
      skill: this.skill,
      stage: 'patch',
      parentSpanId: context.parentSpanId,
      message: isRework
        ? `第 ${attempt} 次返工：${failureFeedback ? `读取失败日志（${failureFeedback.failed} 项失败）后` : ''}修正补丁，${profile.fix.summary}`
        : `经 MCP 工具在隔离工作区复现 ${baselineTests.failed} 个失败，并应用最小补丁：${profile.fix.summary}`,
      evidence: [`baseline-ci://${baselineTests.artifact}`, `patch://${patch.patchDigest}`, `rollback://${patch.rollbackRef}`, `mcp://workspace/${workspaceId}`, ...(patch.baseCommit ? [`git://${patch.baseCommit}`] : []), ...(isRework ? [`rework://${attempt}/${maxAttempts}`] : [])],
      input: { rca: state.artifacts.rca, failureFeedback },
      output: patch
    });
    return patch;
  }
};
