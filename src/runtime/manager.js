import { fileURLToPath } from 'node:url';
import { assertCaseState, createCaseState, terminalStates } from './case-state.js';
import { digest } from './digest.js';
import { recordDispatch } from './trace.js';
import { intakeAgent, impactAgent, learningAgent, patchAgent, rcaAgent, releaseAgent, verifyAgent } from '../agents/index.js';
import { adapters } from '../adapters.js';
import { skills } from '../skills.js';
import { fixturePathForRepository, profileForFixture } from '../fixture-profiles.js';
import { EpisodeStore } from '../knowledge/episode-store.js';
import { EmbeddedMcpClient } from '../mcp/client.js';
import { McpToolServer } from '../mcp/tool-server.js';
import { createTools } from '../mcp/tools.js';
import { ApprovalAuthority, ToolPolicy } from '../security/tool-policy.js';
import { buildOpenTelemetry } from '../observability/otel.js';
import { EvidenceChain } from '../security/evidence-chain.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/checkout-service', import.meta.url));

export class DeliveryManager {
  constructor({ incident, scenario = 'happy-path', approvalState = 'approved', knowledgeStore, controls = {}, providers = {}, releaseVersion = process.env.DEVORBIT_RELEASE_VERSION || null, stateStore = null, fixturePath: managerFixturePath = fixturePath } = {}) {
    this.state = createCaseState(incident, scenario);
    this.knowledgeStore = knowledgeStore || new EpisodeStore();
    this.workspaceRegistry = new Map();
    this.approvalAuthority = new ApprovalAuthority();
    this.toolPolicy = new ToolPolicy({ approvalAuthority: this.approvalAuthority });
    this.toolServer = new McpToolServer({ tools: createTools({ fixturePath: managerFixturePath, workspaceRegistry: this.workspaceRegistry, knowledgeStore: this.knowledgeStore, signals: incident.signals, providers }), policy: this.toolPolicy });
    this.mcp = new EmbeddedMcpClient(this.toolServer);
    const profile = profileForFixture(managerFixturePath);
    this.context = { approvalState, approvalReceipt: null, controls, releaseVersion, fixturePath: managerFixturePath, profile, repositoryRevision: `sha256:${digest(`${profile.repository}@broken-v1`)}`, mcpServer: this.toolServer, restoredFrom: null };
    this.evidenceChain = new EvidenceChain();
    this.stateStore = stateStore;
  }

  async persist() {
    if (!this.stateStore) return;
    try {
      if (terminalStates.has(this.state.state)) {
        await this.stateStore.remove(this.state.case_id);
        return;
      }
      await this.stateStore.save({
        schema: 'devorbit.case-state/v1',
        savedAt: new Date().toISOString(),
        state: this.state,
        evidenceChain: this.evidenceChain.snapshot(),
        restoredFrom: this.context.restoredFrom
      });
    } catch {
      // best-effort 持久化：只读根文件系统等受限环境自动降级为纯内存会话
    }
  }

  async complete(result) {
    await this.persist();
    return result;
  }

  static restore(snapshot, { knowledgeStore, providers = {}, stateStore = null } = {}) {
    const state = snapshot?.state;
    if (!state?.case_id) throw new Error('state snapshot is missing case_id');
    if (state.state !== 'approval_pending') throw new Error(`only approval_pending snapshots can be restored: ${state.state}`);
    assertCaseState(state);
    const manager = new DeliveryManager({ incident: state.incident, scenario: state.scenario, approvalState: 'pending', knowledgeStore, providers, stateStore, fixturePath: fixturePathForRepository(state.incident.repository) });
    manager.state = state;
    manager.evidenceChain = EvidenceChain.fromSnapshot(snapshot.evidenceChain);
    manager.context.restoredFrom = { savedAt: snapshot.savedAt || null, schema: snapshot.schema || null, resumedAfterRestart: true };
    return manager;
  }

  async dispatch(agent, stage) {
    assertCaseState(this.state);
    const parentSpanId = recordDispatch(this.state, agent.id, stage, { state: this.state.state, evidence: this.state.evidence });
    const mcp = this.mcp.forAgent(agent.id, this.state, parentSpanId);
    const output = await agent.execute(this.state, { ...this.context, parentSpanId, mcp });
    assertCaseState(this.state);
    this.evidenceChain.append(stage, output);
    await this.persist();
    return output;
  }

  async run() {
    await this.dispatch(intakeAgent, 'triage');
    this.evidenceChain.append('intake', this.state.artifacts.canonical);
    await this.dispatch(impactAgent, 'impact');
    this.evidenceChain.append('impact', this.state.artifacts.impact);
    await this.dispatch(rcaAgent, 'rca');
    this.evidenceChain.append('rca', this.state.artifacts.rca);
    if (terminalStates.has(this.state.state)) return this.complete(this.result());

    const maxAttempts = this.context.controls.maxPatchAttempts ?? 3;
    for (let cycle = 0; cycle < maxAttempts; cycle++) {
      await this.dispatch(patchAgent, 'patch');
      this.evidenceChain.append('patch', this.state.artifacts.plan);
      await this.dispatch(verifyAgent, 'verify');
      this.evidenceChain.append('verify', this.state.artifacts.tests);
      if (this.state.state === 'verified') break;
      if (terminalStates.has(this.state.state)) return this.complete(await this.finish());
      if (this.state.state !== 'diagnosed') break;
    }

    if (terminalStates.has(this.state.state)) return this.complete(await this.finish());
    this.prepareApprovalReceipt();
    await this.dispatch(releaseAgent, 'release');
    this.evidenceChain.append('release', this.state.artifacts.release);
    if (this.state.state === 'approval_pending') return this.complete(this.result());
    if (this.state.state === 'needs_human') return this.complete(await this.finish());
    await this.dispatch(learningAgent, 'learn');
    this.evidenceChain.append('learn', this.state.artifacts.knowledge);
    return this.complete(await this.finish());
  }

  async resumeApproval(approvalState) {
    if (this.state.state !== 'approval_pending') throw new Error(`case is not awaiting approval: ${this.state.state}`);
    if (!['approved', 'rejected'].includes(approvalState)) throw new Error('approval decision must be approved or rejected');
    this.context.approvalState = approvalState;
    this.prepareApprovalReceipt();
    await this.dispatch(releaseAgent, 'release');
    this.evidenceChain.append('release', this.state.artifacts.release);
    if (this.state.state === 'confirmed' || this.state.state === 'rolled_back') await this.dispatch(learningAgent, 'learn');
    return this.complete(await this.finish());
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
    const dbAssertions = this.state.artifacts.dbAssertions;
    if (dbAssertions && !dbAssertions.allPassed) throw new Error('manager refused approval receipt: DB assertions gate failed');
    this.context.approvalReceipt = this.approvalAuthority.issue({
      caseId: this.state.case_id,
      action: 'release.canary',
      approver: controls.approvalGate === false ? 'evaluation-ablation' : 'release-owner',
      attestation: {
        rca: `${rca?.causes?.[0]?.score}/${rca?.threshold}`,
        tests: tests?.artifact || 'not-run',
        rollback: plan.rollbackRef,
        patchAttempts: plan.attempts,
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
    const evidenceChain = this.evidenceChain.finalize();
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
      evidenceChain,
      state: { caseId: this.state.case_id, traceId: this.state.trace_id, status: this.state.state, revision: this.state.revision, scenario: this.state.scenario, messageCount: this.state.messages.length, restored: Boolean(this.context.restoredFrom), restoredFrom: this.context.restoredFrom },
      trace: structuredClone(this.state.trace),
      messages: structuredClone(this.state.messages),
      skills,
      adapters,
      metrics: { agents: 7, evidence: new Set(this.state.evidence).size, spans: this.state.trace.length, messages: this.state.messages.length, mcpCalls: this.toolServer.audit.length, policyDenials: this.toolServer.audit.filter(item => item.policyDecision === 'deny').length, ragHits: artifacts.rca?.retrieval?.results?.length || 0, resamplingRounds: artifacts.rca?.resampling?.rounds || 0, patchAttempts: artifacts.plan?.attempts || 0, closedLoop, outcome: this.state.outcome || this.state.state },
      observability,
      mcp: { protocolVersion: '2025-06-18', tools: this.toolServer.definitions().map(tool => tool.name), calls: this.toolServer.audit.length, audit: structuredClone(this.toolServer.audit) }
    };
  }
}
