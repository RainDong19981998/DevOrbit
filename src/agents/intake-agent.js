import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const intakeAgent = {
  id: 'intake-worker',
  skill: 'SignalFusion',
  async execute(state, context) {
    const issues = await context.mcp.callTool('issue.fetch_signals', { caseId: state.case_id });
    const telemetry = await context.mcp.callTool('observability.fetch_signals', { caseId: state.case_id });
    const signals = [...issues.data.signals, ...telemetry.data.signals];
    const invalid = signals.filter(signal => !signal.source || !signal.id || !signal.time || !signal.text);
    const quarantineEnabled = context.controls.quarantine !== false;
    const canonical = {
      id: state.case_id,
      title: state.incident.title,
      severity: 'S2',
      confidence: invalid.length && quarantineEnabled ? 0.66 : 0.94,
      duplicateOf: signals.filter(signal => signal.source === 'Issue').map(signal => signal.id),
      timeline: signals.filter(signal => signal.time).map(signal => `${signal.time} ${signal.source}`).sort(),
      sources: signals.length - (quarantineEnabled ? invalid.length : 0),
      quarantined: quarantineEnabled ? invalid.map(signal => signal.id || 'unknown') : [],
      sourceSystems: { issue: issues.data.sourceCount, observability: telemetry.data.sourceCount },
      mcpCalls: [issues.call, telemetry.call]
    };
    mergeArtifact(state, 'canonical', canonical);
    transition(state, 'triaged', 'signals normalized and clustered');
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'triage', parentSpanId: context.parentSpanId, message: `通过 Issue/Observability MCP 拉取并归并 ${canonical.sources} 条有效信号，隔离 ${canonical.quarantined.length} 条坏记录。`, evidence: signals.map(signal => signal.id).filter(Boolean), input: { caseId: state.case_id, tools: [issues.call.tool, telemetry.call.tool] }, output: canonical });
    return canonical;
  }
};
