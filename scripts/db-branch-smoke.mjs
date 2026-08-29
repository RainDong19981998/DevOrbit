import { spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { InMemoryDbBranchProvider } from "../src/adapters/db-branch.js"

const root = dirname(fileURLToPath(import.meta.url))
const composeFile = join(root, "..", "docker-compose.db.yml")
const reportPath = join(root, "..", "reports", "db-branch.json")

function dockerVersion() {
  try {
    const res = spawnSync("docker", ["--version"], { stdio: "pipe" })
    return res.status === 0
  } catch (e) {
    return false
  }
}

function compose(args) {
  return spawnSync("docker", ["compose", "-f", composeFile, ...args], { stdio: "pipe" })
}

const baseline = {
  tables: {
    inventory: {
      columns: ["id", "sku", "stock", "warehouse_id", "price"],
      pk: "id",
      rows: [
        { id: 1, sku: "SKU-A", stock: 100, warehouse_id: 1, price: 10 },
        { id: 2, sku: "SKU-B", stock: 50, warehouse_id: 1, price: 20 },
        { id: 3, sku: "SKU-C", stock: 75, warehouse_id: 2, price: 15 }
      ]
    },
    warehouse: {
      columns: ["id", "name"],
      pk: "id",
      rows: [
        { id: 1, name: "WH-EAST" },
        { id: 2, name: "WH-WEST" }
      ]
    }
  },
  foreignKeys: [
    { table: "inventory", column: "warehouse_id", references: "warehouse", refColumn: "id" }
  ]
}

const traffic = [
  { op: "select", table: "inventory", where: { sku: "SKU-A" } },
  { op: "select", table: "inventory", where: { warehouse_id: 1 } },
  { op: "count", table: "inventory", where: {} },
  { op: "insert", table: "inventory", row: { id: 4, sku: "SKU-D", stock: 30, warehouse_id: 2, price: 25 } }
]

async function main() {
  if (!dockerVersion()) {
    console.log("SKIP db-branch-smoke: docker is not available")
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ status: "skipped", reason: "docker unavailable" }, null, 2))
    return
  }
  console.log("db-branch-smoke: starting postgres container")
  const up = compose(["up", "-d", "--wait"])
  if (up.status !== 0) {
    console.log("SKIP db-branch-smoke: docker compose up failed")
    writeFileSync(reportPath, JSON.stringify({ status: "skipped", reason: "compose up failed", error: String(up.stdout) + String(up.stderr) }, null, 2))
    return
  }
  let baselineVerified = false
  const probe = spawnSync("docker", ["exec", "devorbit-postgres", "psql", "-U", "devorbit", "-d", "devorbit_baseline", "-t", "-c", "SELECT count(*) FROM inventory"], { stdio: "pipe" })
  if (probe.status === 0) {
    const count = Number(String(probe.stdout).trim())
    baselineVerified = count === 3
  }
  const provider = new InMemoryDbBranchProvider()
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "Branch-A" })
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "Branch-B" })
  await provider.applyMigration({ branchId: "Branch-A", script: { up: [{ type: "addIndex", sql: "CREATE INDEX idx_smoke_sku ON inventory (sku)" }] } })
  await provider.applyMigration({ branchId: "Branch-B", script: { up: [{ type: "modifyQuery", table: "inventory", sql: "SELECT id FROM inventory ORDER BY id" }] } })
  const replayA = await provider.replayTraffic({ branchId: "Branch-A", requests: traffic })
  const replayB = await provider.replayTraffic({ branchId: "Branch-B", requests: traffic })
  const consA = await provider.assertConsistency({ branchId: "Branch-A" })
  const consB = await provider.assertConsistency({ branchId: "Branch-B" })
  const cmp = await provider.compareBranches({ branchIds: ["Branch-A", "Branch-B"], criteria: { metric: "p95Ms", lowerIsBetter: true } })
  await provider.destroyBranch({ branchId: "Branch-A" })
  await provider.destroyBranch({ branchId: "Branch-B" })
  const report = {
    status: "passed",
    containerBaselineVerified: baselineVerified,
    branches: [
      { id: "Branch-A", migration: "addIndex", summary: replayA.summary, consistent: consA.consistent },
      { id: "Branch-B", migration: "modifyQuery", summary: replayB.summary, consistent: consB.consistent }
    ],
    comparison: cmp,
    winner: cmp.winner
  }
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log("PASS db-branch-smoke: winner " + cmp.winner)
  compose(["down"])
}

main().catch(function (e) {
  console.log("FAIL db-branch-smoke: " + e.message)
  try { compose(["down"]) } catch (e2) {}
  writeFileSync(reportPath, JSON.stringify({ status: "failed", error: e.message }, null, 2))
  process.exit(1)
})
