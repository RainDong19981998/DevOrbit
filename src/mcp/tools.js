import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { digest } from '../runtime/digest.js';
import { runNodeTests } from '../runtime/test-runner.js';

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function within(root, path) {
  const target = resolve(root, normalize(path));
  const base = resolve(root);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('path escapes workspace');
  return target;
}

export function createTools({ fixturePath, workspaceRegistry, knowledgeStore, signals = [], providers = {} }) {
  return [
    {
      name: 'issue.fetch_signals',
      title: 'Fetch issue and feedback signals',
      description: 'Return issue and user-feedback signals for a delivery case.',
      inputSchema: schema({ caseId: { type: 'string' } }, ['caseId']),
      outputSchema: schema({ signals: { type: 'array' }, sourceCount: { type: 'integer' } }, ['signals', 'sourceCount']),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ caseId }, context) => {
        if (providers.issue) return providers.issue.fetchSignals({ caseId }, context);
        const selected = signals.filter(signal => ['Issue', '用户反馈'].includes(signal.source));
        return { signals: structuredClone(selected), sourceCount: new Set(selected.map(signal => signal.source)).size };
      }
    },
    {
      name: 'observability.fetch_signals',
      title: 'Fetch logs, metrics, traces, and changes',
      description: 'Return observability and change signals for a delivery case.',
      inputSchema: schema({ caseId: { type: 'string' } }, ['caseId']),
      outputSchema: schema({ signals: { type: 'array' }, sourceCount: { type: 'integer' } }, ['signals', 'sourceCount']),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ caseId }, context) => {
        if (providers.observability) return providers.observability.fetchSignals({ caseId }, context);
        const selected = signals.filter(signal => !['Issue', '用户反馈'].includes(signal.source));
        return { signals: structuredClone(selected), sourceCount: new Set(selected.map(signal => signal.source)).size };
      }
    },
    {
      name: 'repository.read_file',
      title: 'Read repository file',
      description: 'Read a UTF-8 file from the approved repository fixture or isolated workspace.',
      inputSchema: schema({ workspaceId: { type: 'string' }, path: { type: 'string' } }, ['path']),
      outputSchema: schema({ path: { type: 'string' }, content: { type: 'string' }, digest: { type: 'string' } }, ['path', 'content', 'digest']),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ workspaceId, path }, context) => {
        if (providers.repository) return providers.repository.readFile({ workspaceId, path }, context);
        const root = workspaceId ? workspaceRegistry.get(workspaceId) : fixturePath;
        if (!root) throw new Error('unknown workspace');
        const content = await readFile(within(root, path), 'utf8');
        return { path, content, digest: `sha256:${digest(content)}` };
      }
    },
    {
      name: 'repository.create_workspace',
      title: 'Create isolated repository workspace',
      description: 'Copy the defect fixture into an isolated writable workspace.',
      inputSchema: schema({ workspaceId: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['workspaceId', 'idempotencyKey']),
      outputSchema: schema({ workspaceId: { type: 'string' }, baseCommit: { type: 'string' }, branch: { type: 'string' } }, ['workspaceId']),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ workspaceId, idempotencyKey }, context) => {
        if (providers.repository) return providers.repository.createWorkspace({ workspaceId, idempotencyKey }, context);
        const workspace = await mkdtemp(join(tmpdir(), 'devorbit-mcp-'));
        await cp(fixturePath, workspace, { recursive: true });
        workspaceRegistry.set(workspaceId, workspace);
        return { workspaceId };
      }
    },
    {
      name: 'repository.write_file',
      title: 'Write repository file',
      description: 'Write a UTF-8 file inside an approved isolated workspace.',
      inputSchema: schema({ workspaceId: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, approvalId: { type: ['string', 'null'] }, idempotencyKey: { type: 'string' } }, ['workspaceId', 'path', 'content', 'idempotencyKey']),
      outputSchema: schema({ path: { type: 'string' }, digest: { type: 'string' } }, ['path', 'digest']),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async ({ workspaceId, path, content, approvalId, idempotencyKey }, context) => {
        if (providers.repository) return providers.repository.writeFile({ workspaceId, path, content, approvalId, idempotencyKey }, context);
        const root = workspaceRegistry.get(workspaceId);
        if (!root) throw new Error('unknown workspace');
        const target = within(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
        return { path, digest: `sha256:${digest(content)}` };
      }
    },
    {
      name: 'repository.dispose_workspace',
      title: 'Dispose isolated repository workspace',
      description: 'Delete an approved isolated workspace after a case reaches a terminal state.',
      inputSchema: schema({ workspaceId: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['workspaceId', 'idempotencyKey']),
      outputSchema: schema({ workspaceId: { type: 'string' }, disposed: { type: 'boolean' } }, ['workspaceId', 'disposed']),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async ({ workspaceId, idempotencyKey }, context) => {
        if (providers.repository) return providers.repository.disposeWorkspace({ workspaceId, idempotencyKey }, context);
        const workspace = workspaceRegistry.get(workspaceId);
        if (!workspace) return { workspaceId, disposed: true };
        await rm(workspace, { recursive: true, force: true });
        workspaceRegistry.delete(workspaceId);
        return { workspaceId, disposed: true };
      }
    },
    {
      name: 'ci.run_tests',
      title: 'Run isolated regression tests',
      description: 'Execute the allowlisted Node test command inside an isolated workspace.',
      inputSchema: schema({ workspaceId: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['workspaceId', 'idempotencyKey']),
      outputSchema: schema({ command: { type: 'string' }, exitCode: { type: 'integer' }, passed: { type: 'integer' }, failed: { type: 'integer' }, skipped: { type: 'integer' }, durationMs: { type: 'integer' }, artifact: { type: 'string' }, outputTail: { type: 'string' } }, ['command', 'exitCode', 'passed', 'failed', 'skipped', 'durationMs', 'artifact', 'outputTail']),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ workspaceId, idempotencyKey }, context) => {
        if (providers.ci) return providers.ci.runTests({ workspaceId, idempotencyKey }, context);
        const workspace = workspaceRegistry.get(workspaceId);
        if (!workspace) throw new Error('unknown workspace');
        return runNodeTests(workspace);
      }
    },
    {
      name: 'knowledge.search_cases',
      title: 'Search historical engineering cases',
      description: 'Retrieve evidence-linked historical cases using lexical and tag matching.',
      inputSchema: schema({ query: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, topK: { type: 'integer', minimum: 1, maximum: 10 } }, ['query']),
      outputSchema: schema({ results: { type: 'array' }, count: { type: 'integer' }, indexSize: { type: 'integer' } }, ['results', 'count', 'indexSize']),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args, context) => {
        if (providers.knowledge) return providers.knowledge.searchCases(args, context);
        const results = knowledgeStore.search(args);
        return { results, count: results.length, indexSize: knowledgeStore.size() };
      }
    },
    {
      name: 'knowledge.write_case',
      title: 'Write engineering knowledge card',
      description: 'Persist a redacted terminal-case knowledge card for later retrieval.',
      inputSchema: schema({ card: { type: 'object' }, idempotencyKey: { type: 'string' } }, ['card', 'idempotencyKey']),
      outputSchema: schema({ stored: { type: 'object' }, indexSize: { type: 'integer' } }, ['stored', 'indexSize']),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ card, idempotencyKey }, context) => {
        if (providers.knowledge) return providers.knowledge.writeCase({ card, idempotencyKey }, context);
        return { stored: knowledgeStore.write(card), indexSize: knowledgeStore.size() };
      }
    },
    {
      name: 'release.canary',
      title: 'Execute controlled canary decision',
      description: 'Evaluate a synthetic canary against deterministic release policy and return promote or rollback.',
      inputSchema: schema({ caseId: { type: 'string' }, version: { type: 'string' }, approvalId: { type: 'string' }, approvalToken: { type: 'string' }, idempotencyKey: { type: 'string' }, regressed: { type: 'boolean' } }, ['caseId', 'version', 'approvalId', 'idempotencyKey', 'regressed']),
      outputSchema: schema({ decision: { type: 'string' }, rollbackExecuted: { type: 'boolean' }, healthBefore: { type: 'object' }, healthAfter: { type: 'object' }, canary: { type: 'string' }, observationWindow: { type: 'string' } }, ['decision', 'rollbackExecuted', 'healthBefore', 'healthAfter', 'canary', 'observationWindow']),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async (args, context) => {
        if (providers.release) return providers.release.canary(args, context);
        const { regressed } = args;
        return {
        decision: regressed ? 'rolled_back' : 'promoted',
        rollbackExecuted: Boolean(regressed),
        healthBefore: { errorRate: 7.4, p95Ms: 2800 },
        healthAfter: regressed ? { errorRate: 9.1, p95Ms: 3400 } : { errorRate: 0.3, p95Ms: 460 },
        canary: '10%',
        observationWindow: '5m'
        };
      }
    }
  ];
}
