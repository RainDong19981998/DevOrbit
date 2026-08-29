import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

const MAX_PATCH_ATTEMPTS = 3;

export const verifyAgent = {
  id: 'verify-worker',
  skill: 'TestGate',
  async execute(state, context) {
    const plan = state.artifacts.plan;
    const maxAttempts = context.controls.maxPatchAttempts ?? MAX_PATCH_ATTEMPTS;
    const attempt = plan?.attempts || 1;
    const toolResult = await context.mcp.callTool('ci.run_tests', { workspaceId: plan.workspaceId, idempotencyKey: `${state.case_id}:patched-tests-${attempt}` });
    const report = { ...toolResult.data, mcpCall: toolResult.call, attempt };
    report.suites = state.artifacts.impact.regressionTests;
    report.gate = report.failed === 0 && report.exitCode === 0 ? 'passed' : 'failed';
    const testGateEnabled = context.controls.testGate !== false;
    const canRework = report.gate === 'failed' && testGateEnabled && attempt < maxAttempts;
    mergeArtifact(state, 'tests', report);
    if (report.gate === 'passed') {
      transition(state, 'verified', `real regression tests passed on attempt ${attempt}`);
      recordTrace(state, { agent: this.id, skill: this.skill, stage: 'verify', parentSpanId: context.parentSpanId, status: 'completed', message: `通过 MCP CI 工具执行 ${report.command}：${report.passed} 通过，${report.failed} 失败（第 ${attempt} 次尝试）。`, evidence: [`ci://${report.artifact}`, 'mcp://ci.run_tests'], input: plan.patchDigest, output: report });
    } else if (canRework) {
      transition(state, 'diagnosed', `test failure on attempt ${attempt}/${maxAttempts}; returning to patch worker for rework`);
      recordTrace(state, { agent: this.id, skill: this.skill, stage: 'verify', parentSpanId: context.parentSpanId, status: 'failed', message: `第 ${attempt}/${maxAttempts} 次尝试测试失败：${report.passed} 通过，${report.failed} 失败。失败日志已回传 patch worker 进行迭代自纠错。`, evidence: [`ci://${report.artifact}`, 'mcp://ci.run_tests', `rework://attempt-${attempt}`], input: plan.patchDigest, output: report });
    } else {
      const blocked = testGateEnabled;
      transition(state, blocked ? 'needs_human' : 'verified', blocked ? `circuit breaker: ${attempt}/${maxAttempts} attempts exhausted, test still failing` : 'test failure ignored by ablation policy');
      recordTrace(state, { agent: this.id, skill: this.skill, stage: 'verify', parentSpanId: context.parentSpanId, status: blocked ? 'circuit_breaker' : 'completed', message: blocked ? `熔断降级：${attempt}/${maxAttempts} 次返工后测试仍失败（${report.passed} 通过，${report.failed} 失败），链路安全停止并请求人工介入。` : `MCP CI 测试失败：${report.passed} 通过，${report.failed} 失败；消融策略允许继续。`, evidence: [`ci://${report.artifact}`, 'mcp://ci.run_tests'], input: plan.patchDigest, output: report });
    }
    return report;
  }
};
