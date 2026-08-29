import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { digest } from "../runtime/digest.js"
import { runNodeTests } from "../runtime/test-runner.js"
import { InMemoryDbBranchProvider } from "../adapters/db-branch.js"

function schema(properties, required) {
  const req = required === undefined ? [] : required
  return { type: "object", properties: properties, required: req, additionalProperties: false }
}

function within(root, path) {
  const target = resolve(root, normalize(path))
  const base = resolve(root)
  if (target !== base) {
    if (!target.startsWith(base + sep)) throw new Error("path escapes workspace")
  }
  return target
}

export function createTools({ fixturePath, workspaceRegistry, knowledgeStore, signals = [], providers = {} }) {
  const defaultDbBranchProvider = providers.dbBranch ?? new InMemoryDbBranchProvider()
  return [
    {
      name: "issue.fetch_signals",
      title: "Fetch issue and feedback signals",
      description: "Return issue and user-feedback signals for a delivery case.",
      inputSchema: schema({ caseId: { type: "string" } }, ["caseId"]),
      outputSchema: schema({ signals: { type: "array" }, sourceCount: { type: "integer" } }, ["signals", "sourceCount"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async function ({ caseId }, context) {
        if (providers.issue) return providers.issue.fetchSignals({ caseId: caseId }, context)
        const selected = signals.filter(function (signal) {
          return ["Issue", "用户反馈"].includes(signal.source)
        })
        return { signals: structuredClone(selected), sourceCount: new Set(selected.map(function (signal) { return signal.source })).size }
      }
    },
    {
      name: "observability.fetch_signals",
      title: "Fetch logs, metrics, traces, and changes",
      description: "Return observability and change signals for a delivery case. Supports layered evidence: surface (misleading symptoms) and deep (supplementary traces fetched during dynamic re-sampling).",
      inputSchema: schema({ caseId: { type: "string" }, granularity: { type: "string", enum: ["surface", "deep"] }, service: { type: "string" }, traceId: { type: "string" } }, ["caseId"]),
      outputSchema: schema({ signals: { type: "array" }, sourceCount: { type: "integer" }, granularity: { type: "string" } }, ["signals", "sourceCount", "granularity"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async function ({ caseId, granularity, service, traceId }, context) {
        const gran = granularity ?? "surface"
        if (providers.observability) {
          const remote = await providers.observability.fetchSignals({ caseId: caseId, granularity: gran, service: service, traceId: traceId }, context)
          return { granularity: gran, ...remote }
        }
        if (gran === "deep") {
          const deepPath = join(fixturePath, "signals", "deep.json")
          try {
            const deep = JSON.parse(await readFile(deepPath, "utf8"))
            let selected = deep
            if (service) {
              selected = selected.filter(function (s) {
                if (!s.source) return true
                if (s.source !== "Trace") return true
                return s.text.includes(service)
              })
            }
            if (traceId) {
              selected = selected.filter(function (s) {
                if (!s.source) return true
                if (s.source !== "Trace") return true
                return s.id === traceId
              })
            }
            return { signals: structuredClone(selected), sourceCount: new Set(selected.map(function (s) { return s.source })).size, granularity: "deep" }
          } catch (e) {
            return { signals: [], sourceCount: 0, granularity: "deep" }
          }
        }
        const selected = signals.filter(function (signal) {
          return !["Issue", "用户反馈"].includes(signal.source)
        })
        return { signals: structuredClone(selected), sourceCount: new Set(selected.map(function (signal) { return signal.source })).size, granularity: "surface" }
      }
    },
    {
      name: "repository.read_file",
      title: "Read repository file",
      description: "Read a UTF-8 file from the approved repository fixture or isolated workspace.",
      inputSchema: schema({ workspaceId: { type: "string" }, path: { type: "string" } }, ["path"]),
      outputSchema: schema({ path: { type: "string" }, content: { type: "string" }, digest: { type: "string" } }, ["path", "content", "digest"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async function ({ workspaceId, path }, context) {
        if (providers.repository) return providers.repository.readFile({ workspaceId: workspaceId, path: path }, context)
        const root = workspaceId ? workspaceRegistry.get(workspaceId) : fixturePath
        if (!root) throw new Error("unknown workspace")
        const content = await readFile(within(root, path), "utf8")
        return { path: path, content: content, digest: "sha256:" + digest(content) }
      }
    },
    {
      name: "repository.create_workspace",
      title: "Create isolated repository workspace",
      description: "Copy the defect fixture into an isolated writable workspace.",
      inputSchema: schema({ workspaceId: { type: "string" }, idempotencyKey: { type: "string" } }, ["workspaceId", "idempotencyKey"]),
      outputSchema: schema({ workspaceId: { type: "string" }, baseCommit: { type: "string" }, branch: { type: "string" } }, ["workspaceId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async function ({ workspaceId, idempotencyKey }, context) {
        if (providers.repository) return providers.repository.createWorkspace({ workspaceId: workspaceId, idempotencyKey: idempotencyKey }, context)
        const workspace = await mkdtemp(join(tmpdir(), "devorbit-mcp-"))
        await cp(fixturePath, workspace, { recursive: true })
        workspaceRegistry.set(workspaceId, workspace)
        return { workspaceId: workspaceId }
      }
    },
    {
      name: "repository.write_file",
      title: "Write repository file",
      description: "Write a UTF-8 file inside an approved isolated workspace.",
      inputSchema: schema({ workspaceId: { type: "string" }, path: { type: "string" }, content: { type: "string" }, approvalId: { type: ["string", "null"] }, idempotencyKey: { type: "string" } }, ["workspaceId", "path", "content", "idempotencyKey"]),
      outputSchema: schema({ path: { type: "string" }, digest: { type: "string" } }, ["path", "digest"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async function ({ workspaceId, path, content, approvalId, idempotencyKey }, context) {
        if (providers.repository) return providers.repository.writeFile({ workspaceId: workspaceId, path: path, content: content, approvalId: approvalId, idempotencyKey: idempotencyKey }, context)
        const root = workspaceRegistry.get(workspaceId)
        if (!root) throw new Error("unknown workspace")
        const target = within(root, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
        return { path: path, digest: "sha256:" + digest(content) }
      }
    },
    {
      name: "repository.dispose_workspace",
      title: "Dispose isolated repository workspace",
      description: "Delete an approved isolated workspace after a case reaches a terminal state.",
      inputSchema: schema({ workspaceId: { type: "string" }, idempotencyKey: { type: "string" } }, ["workspaceId", "idempotencyKey"]),
      outputSchema: schema({ workspaceId: { type: "string" }, disposed: { type: "boolean" } }, ["workspaceId", "disposed"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async function ({ workspaceId, idempotencyKey }, context) {
        if (providers.repository) return providers.repository.disposeWorkspace({ workspaceId: workspaceId, idempotencyKey: idempotencyKey }, context)
        const workspace = workspaceRegistry.get(workspaceId)
        if (!workspace) return { workspaceId: workspaceId, disposed: true }
        await rm(workspace, { recursive: true, force: true })
        workspaceRegistry.delete(workspaceId)
        return { workspaceId: workspaceId, disposed: true }
      }
    },
    {
      name: "ci.run_tests",
      title: "Run isolated regression tests",
      description: "Execute the allowlisted Node test command inside an isolated workspace.",
      inputSchema: schema({ workspaceId: { type: "string" }, idempotencyKey: { type: "string" } }, ["workspaceId", "idempotencyKey"]),
      outputSchema: schema({ command: { type: "string" }, exitCode: { type: "integer" }, passed: { type: "integer" }, failed: { type: "integer" }, skipped: { type: "integer" }, durationMs: { type: "integer" }, artifact: { type: "string" }, outputTail: { type: "string" } }, ["command", "exitCode", "passed", "failed", "skipped", "durationMs", "artifact", "outputTail"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async function ({ workspaceId, idempotencyKey }, context) {
        if (providers.ci) return providers.ci.runTests({ workspaceId: workspaceId, idempotencyKey: idempotencyKey }, context)
        const workspace = workspaceRegistry.get(workspaceId)
        if (!workspace) throw new Error("unknown workspace")
        return runNodeTests(workspace)
      }
    },
    {
      name: "knowledge.search_cases",
      title: "Search historical engineering cases",
      description: "Retrieve evidence-linked historical cases using lexical, tag, and context-constrained matching. Returns recommendations and warnings (negative evidence).",
      inputSchema: schema({ query: { type: "string" }, tags: { type: "array", items: { type: "string" } }, topK: { type: "integer", minimum: 1, maximum: 10 }, context: { type: "object" } }, ["query"]),
      outputSchema: schema({ results: { type: "array" }, count: { type: "integer" }, indexSize: { type: "integer" }, warnings: { type: "array" } }, ["results", "count", "indexSize"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async function (args, context) {
        if (providers.knowledge) return providers.knowledge.searchCases(args, context)
        if (typeof knowledgeStore.searchWithWarnings === "function") {
          var sw = knowledgeStore.searchWithWarnings(args)
          return { results: sw.results, count: sw.results.length, indexSize: knowledgeStore.size(), warnings: sw.warnings }
        }
        var results = knowledgeStore.search(args)
        return { results: results, count: results.length, indexSize: knowledgeStore.size(), warnings: [] }
      }
    },
    {
      name: "knowledge.write_case",
      title: "Write engineering knowledge card",
      description: "Persist a redacted terminal-case knowledge card for later retrieval.",
      inputSchema: schema({ card: { type: "object" }, idempotencyKey: { type: "string" } }, ["card", "idempotencyKey"]),
      outputSchema: schema({ stored: { type: "object" }, indexSize: { type: "integer" } }, ["stored", "indexSize"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async function ({ card, idempotencyKey }, context) {
        if (providers.knowledge) return providers.knowledge.writeCase({ card: card, idempotencyKey: idempotencyKey }, context)
        return { stored: knowledgeStore.write(card), indexSize: knowledgeStore.size() }
      }
    },
    {
      name: "release.canary",
      title: "Execute controlled canary decision",
      description: "Evaluate a synthetic canary against deterministic release policy and return promote or rollback.",
      inputSchema: schema({ caseId: { type: "string" }, version: { type: "string" }, approvalId: { type: "string" }, approvalToken: { type: "string" }, idempotencyKey: { type: "string" }, regressed: { type: "boolean" } }, ["caseId", "version", "approvalId", "idempotencyKey", "regressed"]),
      outputSchema: schema({ decision: { type: "string" }, rollbackExecuted: { type: "boolean" }, healthBefore: { type: "object" }, healthAfter: { type: "object" }, canary: { type: "string" }, observationWindow: { type: "string" } }, ["decision", "rollbackExecuted", "healthBefore", "healthAfter", "canary", "observationWindow"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async function (args, context) {
        if (providers.release) return providers.release.canary(args, context)
        const regressed = args.regressed
        return {
          decision: regressed ? "rolled_back" : "promoted",
          rollbackExecuted: Boolean(regressed),
          healthBefore: { errorRate: 7.4, p95Ms: 2800 },
          healthAfter: regressed ? { errorRate: 9.1, p95Ms: 3400 } : { errorRate: 0.3, p95Ms: 460 },
          canary: "10%",
          observationWindow: "5m"
        }
      }
    },
    {
      name: "db.create_branch",
      title: "Create isolated database branch",
      description: "Create an isolated database branch from a baseline snapshot for multi-hypothesis parallel validation.",
      inputSchema: schema({ baselineSnapshot: { type: "object" }, branchId: { type: "string" } }, ["branchId"]),
      outputSchema: schema({ branchId: { type: "string" }, tables: { type: "array", items: { type: "string" } } }, ["branchId", "tables"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async function (args, context) {
        const provider = providers.dbBranch ?? defaultDbBranchProvider
        return provider.createBranch(args, context)
      }
    },
    {
      name: "db.apply_migration",
      title: "Apply migration to database branch",
      description: "Apply a SQL migration script to an isolated branch with guardrails blocking destructive operations.",
      inputSchema: schema({ branchId: { type: "string" }, script: { type: "object" } }, ["branchId", "script"]),
      outputSchema: schema({ branchId: { type: "string" }, applied: { type: "integer" }, steps: { type: "array" } }, ["branchId", "applied", "steps"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async function (args, context) {
        const provider = providers.dbBranch ?? defaultDbBranchProvider
        return provider.applyMigration(args, context)
      }
    },
    {
      name: "db.replay_traffic",
      title: "Replay incident traffic against database branch",
      description: "Replay incident traffic requests against an isolated branch and return results with latency metrics.",
      inputSchema: schema({ branchId: { type: "string" }, requests: { type: "array" } }, ["branchId", "requests"]),
      outputSchema: schema({ branchId: { type: "string" }, results: { type: "array" }, summary: { type: "object" } }, ["branchId", "results", "summary"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async function (args, context) {
        const provider = providers.dbBranch ?? defaultDbBranchProvider
        return provider.replayTraffic(args, context)
      }
    },
    {
      name: "db.compare_and_select",
      title: "Compare branches and select winner",
      description: "Compare multiple database branches by cost metric and return ranking with the selected winner.",
      inputSchema: schema({ branchIds: { type: "array", items: { type: "string" } }, criteria: { type: "object" } }, ["branchIds"]),
      outputSchema: schema({ ranking: { type: "array" }, winner: { type: ["string", "null"] }, criteria: { type: "object" } }, ["ranking", "winner", "criteria"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async function (args, context) {
        const provider = providers.dbBranch ?? defaultDbBranchProvider
        return provider.compareBranches(args, context)
      }
    }
  ]
}
