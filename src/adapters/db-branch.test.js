import assert from "node:assert/strict"
import { test } from "node:test"
import { InMemoryDbBranchProvider, createDbBranchProvider, DbBranchError } from "./db-branch.js"

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

test("full flow create migrate replay assert compare destroy", async function () {
  const provider = new InMemoryDbBranchProvider()
  const created = await provider.createBranch({ baselineSnapshot: baseline, branchId: "full" })
  assert.ok(created.tables.includes("inventory"))
  assert.ok(created.tables.includes("warehouse"))
  const mig = await provider.applyMigration({
    branchId: "full",
    script: { up: [
      { type: "addIndex", sql: "CREATE INDEX idx_inv_sku ON inventory (sku)" },
      { type: "rawSQL", sql: "ALTER TABLE inventory ADD COLUMN updated_at TEXT" }
    ] }
  })
  assert.equal(mig.applied, 2)
  const replay = await provider.replayTraffic({ branchId: "full", requests: traffic })
  assert.equal(replay.summary.total, traffic.length)
  assert.equal(replay.summary.ok, traffic.length)
  assert.equal(replay.summary.failed, 0)
  const cons = await provider.assertConsistency({ branchId: "full" })
  assert.equal(cons.consistent, true)
  const cmp = await provider.compareBranches({ branchIds: ["full"], criteria: { metric: "p95Ms" } })
  assert.equal(cmp.winner, "full")
  const destroyed = await provider.destroyBranch({ branchId: "full" })
  assert.equal(destroyed.disposed, true)
})

test("multi hypothesis parallel index vs paging rewrite", async function () {
  const provider = new InMemoryDbBranchProvider()
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "A" })
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "B" })
  await provider.applyMigration({
    branchId: "A",
    script: { up: [{ type: "addIndex", sql: "CREATE INDEX idx_a_sku ON inventory (sku)" }] }
  })
  await provider.applyMigration({
    branchId: "B",
    script: { up: [{ type: "modifyQuery", table: "inventory", sql: "SELECT id FROM inventory ORDER BY id" }] }
  })
  await provider.replayTraffic({ branchId: "A", requests: traffic })
  await provider.replayTraffic({ branchId: "B", requests: traffic })
  const cmp = await provider.compareBranches({ branchIds: ["A", "B"], criteria: { metric: "p95Ms", lowerIsBetter: true } })
  assert.equal(cmp.ranking.length, 2)
  assert.ok(cmp.ranking[0].value <= cmp.ranking[1].value)
  assert.equal(cmp.winner, cmp.ranking[0].branchId)
  assert.notEqual(cmp.winner, null)
})

test("guardrail blocks drop table and whereless writes", async function () {
  const provider = new InMemoryDbBranchProvider()
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "g" })
  await assert.rejects(
    provider.applyMigration({ branchId: "g", script: { up: [{ type: "rawSQL", sql: "DROP TABLE inventory" }] } }),
    function (err) { return err instanceof DbBranchError ? err.code === "migration_blocked" : false }
  )
  await assert.rejects(
    provider.applyMigration({ branchId: "g", script: { up: [{ type: "rawSQL", sql: "UPDATE inventory SET stock = 0" }] } }),
    function (err) { return err instanceof DbBranchError ? err.reason === "destructive_without_where" : false }
  )
  await assert.rejects(
    provider.applyMigration({ branchId: "g", script: { up: [{ type: "rawSQL", sql: "DELETE FROM inventory" }] } }),
    function (err) { return err instanceof DbBranchError ? err.reason === "destructive_without_where" : false }
  )
})

test("zero pollution after branch destroy", async function () {
  const before = JSON.stringify(baseline.tables.inventory.rows)
  const provider = new InMemoryDbBranchProvider()
  await provider.createBranch({ baselineSnapshot: baseline, branchId: "z" })
  await provider.applyMigration({
    branchId: "z",
    script: { up: [{ type: "rawSQL", sql: "DELETE FROM inventory WHERE id = 1" }] }
  })
  const destroyed = await provider.destroyBranch({ branchId: "z" })
  assert.equal(destroyed.disposed, true)
  const after = JSON.stringify(baseline.tables.inventory.rows)
  assert.equal(before, after)
})

test("factory memory default and remote placeholder", function () {
  const mem = createDbBranchProvider({ provider: "memory" })
  assert.ok(mem instanceof InMemoryDbBranchProvider)
  const memDefault = createDbBranchProvider({})
  assert.ok(memDefault instanceof InMemoryDbBranchProvider)
  assert.throws(function () {
    createDbBranchProvider({ provider: "polardb", config: {} })
  }, function (err) { return err instanceof DbBranchError ? err.code === "provider_credentials_required" : false })
  const polar = createDbBranchProvider({ provider: "polardb", config: { credentials: { host: "h", user: "u", database: "d", password: "p" } } })
  assert.equal(polar.degraded, true)
  const pg = createDbBranchProvider({ provider: "postgresql", config: { connectionUrl: "postgres://x" } })
  assert.equal(pg.degraded, true)
  assert.throws(function () {
    createDbBranchProvider({ provider: "unknown" })
  }, function (err) { return err instanceof DbBranchError })
})
