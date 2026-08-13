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
      version: context.releaseVersion || 'checkout-service@2026.08.12-rc3',
      approvalId: approval.approvalId,
      approvalToken: approvalReceipt.token,
      idempotencyKey: `${state.case_id}:promote:rc3`,
      regressed
    });
    const release = {
      ...toolResult.data,
      version: context.releaseVersion || 'checkout-service@2026.08.12-rc3',
      idempotencyKey: `${state.case_id}:promote:rc3`,
      rollbackReady: true,
      toolCalled: true,
      mcpCall: toolResult.call
    };
    if (!['promoted', 'rolled_back'].includes(release.decision)) throw new Error(`release provider returned unsupported decision: ${release.decision}`);
    mergeArtifact(state, 'release', release);
    const rolledBack = release.decision === 'rolled_back';
    transition(state, rolledBack ? 'rolled_back' : 'confirmed', rolledBack ? 'release provider reported degradation; verified rollback executed' : 'release provider reported canary healthy');
    const metricEvidence = Number.isFinite(release.healthAfter?.errorRate) ? `metric://error-rate/${release.healthAfter.errorRate}` : `rollout-status://${release.decision}`;
    const message = rolledBack
      ? `MCP 发布工具返回退化结论并完成可验证回滚（${release.observationWindow}）。`
      : `MCP 发布工具确认 ${release.canary} 灰度健康（${release.observationWindow}），允许放量。`;
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'release', parentSpanId: context.parentSpanId, status: release.decision, message, evidence: [`approval://${approval.approvalId}`, `rollout://${release.version}`, metricEvidence, 'mcp://release.canary'], input: { tests: state.artifacts.tests, approval }, output: release });
    return release;
  }
};
