import { fileURLToPath } from 'node:url';
import { assertCaseState, createCaseState, terminalStates } from './case-state.js';
import { digest } from './digest.js';
import { recordDispatch } from './trace.js';
import { intakeAgent, impactAgent, learningAgent, patchAgent, rcaAgent, releaseAgent, verifyAgent } from '../agents/index.js';
import { adapters } from '../adapters.js';
import { skills } from '../skills.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { EmbeddedMcpClient } from '../mcp/client.js';
import { McpToolServer } from '../mcp/tool-server.js';
import { createTools } from '../mcp/tools.js';
import { ApprovalAuthority, ToolPolicy } from '../security/tool-policy.js';
import { buildOpenTelemetry } from '../observability/otel.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/checkout-service', import.meta.url));

export class DeliveryManager {
  constructor({ incident, scenario = 'happy-path', approvalState = 'approved', knowledgeStore, controls = {}, providers = {} } = {}) {
    this.state = createCaseState(incident, scenario);
    this.knowledgeStore = knowledgeStore || new KnowledgeStore();
    this.workspaceRegistry = new Map();
    this.approvalAuthority = new ApprovalAuthority();
    this.toolPolicy = new ToolPolicy({ approvalAuthority: this.approvalAuthority });
    this.toolServer = new McpToolServer({ tools: createTools({ fixturePath, workspaceRegistry: this.workspaceRegistry, knowledgeStore: this.knowledgeStore, signals: incident.signals, providers }), policy: this.toolPolicy });
    this.mcp = new EmbeddedMcpClient(this.toolServer);
    this.context = { approvalState, approvalReceipt: null, controls, fixturePath, repositoryRevision: `sha256:${digest('checkout-service@broken-v1')}`, mcpServer: this.toolServer };
  }

  async dispatch(agent, stage) {
    assertCaseState(this.state);
    const parentSpanId = recordDispatch(this.state, agent.id, stage, { state: this.state.state, evidence: this.state.evidence });
    const mcp = this.mcp.forAgent(agent.id, this.state, parentSpanId);
    const output = await agent.execute(this.state, { ...this.context, parentSpanId, mcp });
    assertCaseState(this.state);
    return output;
  }

  async run() {
    await this.dispatch(intakeAgent, 'triage');
    await this.dispatch(impactAgent, 'impact');
    await this.dispatch(rcaAgent, 'rca');
    if (terminalStates.has(this.state.state)) return this.result();
    await this.dispatch(patchAgent, 'patch');
    await this.dispatch(verifyAgent, 'verify');
    if (terminalStates.has(this.state.state)) return this.finish();
    this.prepareApprovalReceipt();
    await this.dispatch(releaseAgent, 'release');
    if (this.state.state === 'approval_pending') return this.result();
    if (this.state.state === 'needs_human') return this.finish();
    await this.dispatch(learningAgent, 'learn');
    return this.finish();
  }

  async resumeApproval(approvalState) {
    if (this.state.state !== 'approval_pending') throw new Error(`case is not awaiting approval: ${this.state.state}`);
    if (!['approved', 'rejected'].includes(approvalState)) throw new Error('approval decision must be approved or rejected');
    this.context.approvalState = approvalState;
    this.prepareApprovalReceipt();
    await this.dispatch(releaseAgent, 'release');
    if (this.state.state === 'confirmed' || this.state.state === 'rolled_back') await this.dispatch(learningAgent, 'learn');
    return this.finish();
  }

  prepareApprovalReceipt() {
    this.context.approvalReceipt = null;
    const controls = this.context.controls;
    const effectiveApproval = controls.approvalGate === false ? 'approved' : this.context.approvalState;
    if (effectiveApproval !== 'approved') return;
    const rca = this.state.artifacts.rca;
    const tests = this.state.artifacts.tests;
    const plan = this.state.artifacts.plan;
    const rcaAccepted = rca?.causes?.[0]?.score >= rca?.threshold;
    const testsPassed = tests?.gate === 'passed';
    const rollbackReady = Boolean(plan?.rollbackRef);
    if (controls.evidenceGate !== false && !rcaAccepted) throw new Error('manager refused approval receipt: RCA gate failed');
    if (controls.testGate !== false && !testsPassed) throw new Error('manager refused approval receipt: test gate failed');
    if (!rollbackReady) throw new Error('manager refused approval receipt: rollback gate failed');
    this.context.approvalReceipt = this.approvalAuthority.issue({
      caseId: this.state.case_id,
      action: 'release.canary',
      approver: controls.approvalGate === false ? 'evaluation-ablation' : 'release-owner',
      attestation: {
        rca: `${rca?.causes?.[0]?.score}/${rca?.threshold}`,
        tests: tests?.artifact || 'not-run',
        rollback: plan.rollbackRef,
        policyProfile: Object.keys(controls).length ? 'evaluation-ablation' : 'production-default'
      }
    });
  }

  async disposeWorkspace() {
    const plan = this.state.artifacts.plan;
    if (!plan?.workspaceId || plan.workspaceDisposed) return;
    const mcp = this.mcp.forAgent('devorbit-lead', this.state);
    const disposed = await mcp.callTool('repository.dispose_workspace', { workspaceId: plan.workspaceId, idempotencyKey: `${this.state.case_id}:dispose-workspace` });
    plan.workspaceDisposed = disposed.data.disposed;
    plan.workspace = undefined;
  }

  async finish() {
    await this.disposeWorkspace();
    return this.result();
  }

  result() {
    const artifacts = this.state.artifacts;
    const closedLoop = this.state.state === 'learned';
    const observability = buildOpenTelemetry(this.state, this.toolServer.audit);
    return {
      incident: this.state.incident,
      canonical: artifacts.canonical,
      impact: artifacts.impact,
      causes: artifacts.rca?.causes || [],
      rca: artifacts.rca,
      plan: artifacts.plan ? structuredClone(artifacts.plan) : null,
      tests: artifacts.tests || null,
      approval: artifacts.approval || null,
      release: artifacts.release || null,
      knowledge: artifacts.knowledge || null,
      state: { caseId: this.state.case_id, traceId: this.state.trace_id, status: this.state.state, revision: this.state.revision, scenario: this.state.scenario, messageCount: this.state.messages.length },
      trace: structuredClone(this.state.trace),
      messages: structuredClone(this.state.messages),
      skills,
      adapters,
      metrics: { agents: 7, evidence: new Set(this.state.evidence).size, spans: this.state.trace.length, messages: this.state.messages.length, mcpCalls: this.toolServer.audit.length, policyDenials: this.toolServer.audit.filter(item => item.policyDecision === 'deny').length, ragHits: artifacts.rca?.retrieval?.results?.length || 0, closedLoop, outcome: this.state.outcome || this.state.state },
      observability,
      mcp: { protocolVersion: '2025-06-18', tools: this.toolServer.definitions().map(tool => tool.name), calls: this.toolServer.audit.length, audit: structuredClone(this.toolServer.audit) }
    };
  }
}
