import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const verifyAgent = {
  id: 'verify-worker',
  skill: 'TestGate',
  async execute(state, context) {
    const toolResult = await context.mcp.callTool('ci.run_tests', { workspaceId: state.artifacts.plan.workspaceId, idempotencyKey: `${state.case_id}:patched-tests` });
    const report = { ...toolResult.data, mcpCall: toolResult.call };
    report.suites = state.artifacts.impact.regressionTests;
    report.gate = report.failed === 0 && report.exitCode === 0 ? 'passed' : 'failed';
    const blocked = report.gate === 'failed' && context.controls.testGate !== false;
    mergeArtifact(state, 'tests', report);
    transition(state, blocked ? 'needs_human' : 'verified', report.gate === 'passed' ? 'real regression tests passed' : blocked ? 'real regression tests failed' : 'test failure ignored by ablation policy');
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'verify', parentSpanId: context.parentSpanId, status: blocked ? 'failed' : 'completed', message: report.gate === 'passed' ? `通过 MCP CI 工具执行 ${report.command}：${report.passed} 通过，${report.failed} 失败。` : `MCP CI 测试失败：${report.passed} 通过，${report.failed} 失败；${blocked ? '发布链路已阻断。' : '消融策略允许继续。'}`, evidence: [`ci://${report.artifact}`, 'mcp://ci.run_tests'], input: state.artifacts.plan.patchDigest, output: report });
    return report;
  }
};
