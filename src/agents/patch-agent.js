import { mergeArtifact, transition } from '../runtime/case-state.js';
import { digest } from '../runtime/digest.js';
import { recordTrace } from '../runtime/trace.js';
import { proposeEditsFromEvidence } from '../reasoning/evidence-reasoner.js';

const MAX_PATCH_ATTEMPTS = 3;

function isSelfHealingScenario(state) {
  return state.scenario === 'self-healing' || state.scenario === 'circuit-breaker';
}

export const patchAgent = {
  id: 'patch-worker',
  skill: 'PatchPlan',
  async execute(state, context) {
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
    const sourceFiles = [];
    for (const path of context.profile.sourceFiles) {
      const before = await context.mcp.callTool('repository.read_file', { workspaceId, path });
      sourceFiles.push({ path, content: before.data.content, digest: before.data.digest });
    }
    const baseline = priorPlan?.baselineTests || await context.mcp.callTool('ci.run_tests', { workspaceId, idempotencyKey: `${state.case_id}:baseline-tests-${attempt}` });

    const usePartialFix = state.scenario === 'circuit-breaker' || (isSelfHealingScenario(state) && attempt === 1);
    const proposal = proposeEditsFromEvidence({ files: sourceFiles, scenario: state.scenario, attempt });
    if (proposal.edits.length === 0 && isRework && ['test-failure', 'circuit-breaker'].includes(state.scenario)) {
      proposal.edits.push({ path: sourceFiles[0].path, before: sourceFiles[0].content, content: sourceFiles[0].content });
      proposal.summary = '失败反馈未支持新的安全编辑，记录 no-op 尝试并交由最大返工次数门禁熔断';
    }
    if (proposal.edits.length === 0) throw new Error('evidence reasoner produced no verifiable source edit');
    const writes = [];
    for (const edit of proposal.edits) {
      writes.push(await context.mcp.callTool('repository.write_file', { workspaceId, path: edit.path, content: edit.content, idempotencyKey: `${state.case_id}:write:${edit.path}:${attempt}` }));
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
      summary: `${isRework ? `第 ${attempt} 次返工：` : ''}${proposal.summary}`,
      files: proposal.edits.map(edit => edit.path),
      patch: proposal.edits.map(edit => `${edit.path}: sha256:${digest(edit.before)} -> sha256:${digest(edit.content)}`).join('\n'),
      rollbackRef: `sha256:${digest(sourceFiles.map(file => file.content).join('\n'))}`,
      patchDigest: `sha256:${digest(proposal.edits.map(edit => edit.content).join('\n'))}`,
      baselineTests,
      mcpCalls: writes.map(write => write.call),
      reasoning: { driver: proposal.driver, deterministicFallback: proposal.deterministicFallback, inputSourceDigests: sourceFiles.map(file => file.digest) },
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
  }
};
