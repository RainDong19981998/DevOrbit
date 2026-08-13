import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const releaseAgent = {
  id: 'release-worker',
  skill: 'ReleaseGuard',
  async execute(state, context) {
    const approvalState = context.controls.approvalGate === false ? 'approved' : (context.approvalState || 'approved');
    const approvalReceipt = context.approvalReceipt;
    if (approvalState === 'approved' && !approvalReceipt) throw new Error('release worker did not receive a manager-signed gate receipt');
    const approval = {
      required: context.controls.approvalGate !== false,
      approver: 'release-owner',
      state: approvalState,
      approvalId: approvalReceipt?.approvalId || (approvalState === 'rejected' ? `APR-${state.case_id.slice(-8)}` : null),
      receiptVerified: Boolean(approvalReceipt),
      reason: 'L2 可逆变更，10% 灰度观察'
    };
    mergeArtifact(state, 'approval', approval);
    if (approvalState !== 'approved') {
      const next = approvalState === 'pending' ? 'approval_pending' : 'needs_human';
      transition(state, next, `release approval ${approvalState}`);
      const release = { decision: approvalState, rollbackReady: true, toolCalled: false };
      mergeArtifact(state, 'release', release);
      recordTrace(state, { agent: this.id, skill: this.skill, stage: 'release', parentSpanId: context.parentSpanId, status: next, message: approvalState === 'pending' ? 'L2 门禁暂停，发布工具尚未调用。' : '审批被拒绝，发布工具未调用，链路安全停止。', evidence: ['policy://L2'], input: { tests: state.artifacts.tests, approval }, output: release });
      return release;
    }
    transition(state, 'canary', 'approval verified and canary started');
    const regressed = state.scenario === 'canary-regression' && context.controls.canaryGuard !== false;
    const toolResult = await context.mcp.callTool('release.canary', {
      caseId: state.case_id,
      version: 'checkout-service@2026.08.12-rc3',
      approvalId: approval.approvalId,
      approvalToken: approvalReceipt.token,
      idempotencyKey: `${state.case_id}:promote:rc3`,
      regressed
    });
    const release = {
      ...toolResult.data,
      version: 'checkout-service@2026.08.12-rc3',
      idempotencyKey: `${state.case_id}:promote:rc3`,
      rollbackReady: true,
      toolCalled: true,
      mcpCall: toolResult.call
    };
    mergeArtifact(state, 'release', release);
    transition(state, regressed ? 'rolled_back' : 'confirmed', regressed ? 'canary thresholds breached; deterministic rollback executed' : 'canary health verified');
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'release', parentSpanId: context.parentSpanId, status: release.decision, message: regressed ? '通过 MCP 灰度工具发现错误率升至 9.1%，超过阈值；策略引擎直接执行回滚。' : '通过 MCP 灰度工具完成 10% 健康检查，错误率降至 0.3%，确认放量。', evidence: [`approval://${approval.approvalId}`, 'rollout://rc3', `metric://error-rate/${release.healthAfter.errorRate}`, 'mcp://release.canary'], input: { tests: state.artifacts.tests, approval }, output: release });
    return release;
  }
};
