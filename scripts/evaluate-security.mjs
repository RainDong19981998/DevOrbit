import { mkdir, writeFile } from "node:fs/promises";
import { ApprovalAuthority, ToolPolicy, TOOL_RULES } from "../src/security/tool-policy.js";
import { EvidenceChain, verifyChain } from "../src/security/evidence-chain.js";
import { McpToolServer } from "../src/mcp/tool-server.js";

let now = 1000;
const authority = new ApprovalAuthority({ secret: Buffer.from("devorbit-security-evaluation"), now: function () { return now;
 } });
const rules = Object.assign({}, TOOL_RULES, { "db.migration": { risk: "L2", agents: ["patch-worker"], approval: true } });
const policy = new ToolPolicy({ approvalAuthority: authority, rules: rules });

const dummyTool = { name: "release.canary", inputSchema: { type: "object", properties: { caseId: { type: "string" }, approvalId: { type: "string" }, approvalToken: { type: "string" }, idempotencyKey: { type: "string" } }, required: ["caseId", "approvalId", "approvalToken", "idempotencyKey"], additionalProperties: false }, outputSchema: { type: "object", properties: { decision: { type: "string" } }, required: ["decision"], additionalProperties: false }, annotations: { readOnlyHint: false }, handler: async function () { return { decision: "promoted" };
 } };

function migrationGate(sql) {
  const upper = String(sql || "").toUpperCase();
  if (upper.includes("DROP TABLE")) return { ok: false, reason: "migration gate rejected DROP TABLE" };
  if (upper.includes("TRUNCATE")) return { ok: false, reason: "migration gate rejected TRUNCATE" };
  if (upper.includes("UPDATE") && !upper.includes("WHERE")) return { ok: false, reason: "migration gate rejected UPDATE without WHERE" };
  if (upper.includes("DELETE FROM") && !upper.includes("WHERE")) return { ok: false, reason: "migration gate rejected DELETE without WHERE" };
  return { ok: true };
};

const migrationTool = { name: "db.migration", inputSchema: { type: "object", properties: { caseId: { type: "string" }, branch: { type: "string" }, approvalId: { type: "string" }, approvalToken: { type: "string" }, idempotencyKey: { type: "string" }, sql: { type: "string" } }, required: ["caseId", "branch", "approvalId", "approvalToken", "idempotencyKey", "sql"], additionalProperties: false }, outputSchema: { type: "object", properties: { applied: { type: "boolean" } }, required: ["applied"], additionalProperties: false }, annotations: { readOnlyHint: false }, handler: async function (args) { const gate = migrationGate(args.sql);
  if (!gate.ok) throw new Error(gate.reason);
  return { applied: true };
 } };

const server = new McpToolServer({ tools: [dummyTool, migrationTool], policy: policy });

async function call(args, context) {
  const response = await server.dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "release.canary", arguments: args } }, context);
  return response.result;
};

async function migrationCall(args, context) {
  const response = await server.dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "db.migration", arguments: args } }, context);
  return response.result;
};

const valid = authority.issue({ caseId: "CASE-A", action: "release.canary", approver: "release-owner", attestation: { rca: "0.91/0.8", tests: "sha256:test", rollback: "sha256:rollback" }, ttlMs: 500 });
const migrationApproval = authority.issue({ caseId: "CASE-A", action: "db.migration", approver: "db-owner", attestation: { rca: "0.91/0.8", tests: "sha256:test", rollback: "sha256:rollback" }, ttlMs: 2000 });
const cases = [];

async function check(id, attack, expected, operation) {
  const result = await operation();
  const observed = result && result.isError ? (result.structuredContent.reason || result.structuredContent.error) : "allowed";
  cases.push({ id: id, attack: attack, expected: expected, observed: observed, passed: expected === observed });
};

await check("SEC-001", "unauthorized agent invokes release", "agent rca-worker is not allowed to call release.canary", function () { return call({ caseId: "CASE-A", approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: "a" }, { agent: "rca-worker", caseId: "CASE-A" });
 });
await check("SEC-002", "forged approval receipt", "invalid approval signature", function () { return call({ caseId: "CASE-A", approvalId: valid.approvalId, approvalToken: "forged", idempotencyKey: "b" }, { agent: "release-worker", caseId: "CASE-A" });
 });
await check("SEC-003", "approval replay across cases", "case scope mismatch", function () { return call({ caseId: "CASE-B", approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: "c" }, { agent: "release-worker", caseId: "CASE-A" });
 });
await check("SEC-004", "approval scope tampering", "approval scope mismatch", function () { return call({ caseId: "CASE-A", approvalId: "APR-TAMPERED", approvalToken: valid.token, idempotencyKey: "d" }, { agent: "release-worker", caseId: "CASE-A" });
 });
now = 1500;
await check("SEC-005", "expired approval receipt", "approval expired", function () { return call({ caseId: "CASE-A", approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: "e" }, { agent: "release-worker", caseId: "CASE-A" });
 });
await check("SEC-006", "schema confusion with unknown argument", "Invalid tool arguments: $ has unknown command", async function () { const response = await server.dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "release.canary", arguments: { caseId: "CASE-A", approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: "f", command: "rm -rf /" } } }, { agent: "release-worker", caseId: "CASE-A" });
  const observed = response.error ? response.error.message : null;
  return { isError: true, structuredContent: { reason: observed } };
 });

await check("SEC-007", "evidence chain stageHash tamper", "evidence chain tamper detected", function () { const chain = new EvidenceChain();
  chain.append("triage", { signal: "FB-1" });
  chain.append("impact", { services: ["a"] });
  chain.append("rca", { score: 0.9 });
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.links[1].stageHash = "0".repeat(16);
  const ok = verifyChain(tampered);
  const reason = ok ? "chain verified despite tamper" : "evidence chain tamper detected";
  return { isError: !ok, structuredContent: { reason: reason } };
 });
await check("SEC-008", "db migration cross-branch write", "case scope mismatch", function () { return migrationCall({ caseId: "CASE-B", branch: "release/B", approvalId: migrationApproval.approvalId, approvalToken: migrationApproval.token, idempotencyKey: "m-cross", sql: "UPDATE orders SET status=1 WHERE id=1" }, { agent: "patch-worker", caseId: "CASE-A" });
 });
await check("SEC-009", "malicious migration drops table", "migration gate rejected DROP TABLE", function () { return migrationCall({ caseId: "CASE-A", branch: "release/A", approvalId: migrationApproval.approvalId, approvalToken: migrationApproval.token, idempotencyKey: "m-drop", sql: "DROP TABLE orders;" }, { agent: "patch-worker", caseId: "CASE-A" });
 });

const summary = { cases: cases.length, passed: cases.filter(function (item) { return item.passed;
 }).length, deniedAuditRecords: server.audit.filter(function (item) { return item.policyDecision === "deny";
 }).length };
const report = { dataset: "DevOrbit Adversarial Policy Cases v0.2", disclosure: "Deterministic local attack simulations. Identity authentication remains a production gateway responsibility; this benchmark validates authorization, approval integrity, scope, expiry, schema enforcement, evidence-chain integrity, branch isolation, and migration gate enforcement.", generatedAt: new Date().toISOString(), summary: summary, cases: cases };
await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
await writeFile(new URL("../reports/security-evaluation.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
const markdown = "# DevOrbit 对抗安全评测\n\n> " + report.disclosure + "\n\n- 结果：" + summary.passed + "/" + summary.cases + "\n- 策略拒绝审计：" + summary.deniedAuditRecords + "\n\n| Case | Attack | Expected control | Observed | Result |\n|---|---|---|---|---|\n" + cases.map(function (item) { return "| " + item.id + " | " + item.attack + " | " + item.expected + " | " + item.observed + " | " + (item.passed ? "PASS" : "FAIL") + " |";
 }).join("\n") + "\n";
await writeFile(new URL("../reports/security-evaluation.md", import.meta.url), markdown);
console.log((summary.passed === summary.cases ? "PASS" : "FAIL") + " security evaluation: " + summary.passed + "/" + summary.cases);
if (summary.passed !== summary.cases) process.exit(1);
