// DevOrbit Module C: Polar Agentic Database Branch
// In-memory isolated branches for multi-hypothesis parallel validation
// Pure Node.js standard library, ESM, no third-party npm dependencies

const QUOTE_CHAR = 39

export class DbBranchError extends Error {
  constructor(message, options) {
    super(message)
    this.name = "DbBranchError"
    const opts = options ?? {}
    this.code = opts.code ?? "db_branch_error"
    this.branchId = opts.branchId ?? null
    this.reason = opts.reason ?? null
    this.retryable = Boolean(opts.retryable)
  }
}

function isObject(value) {
  if (value === null) return false
  if (typeof value !== "object") return false
  if (Array.isArray(value)) return false
  return true
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function coerceLiteral(raw) {
  if (raw === null) return null
  if (raw === undefined) return null
  const s = String(raw).trim()
  if (s === "") return null
  if (s === "NULL") return null
  if (s === "null") return null
  if (s === "true") return true
  if (s === "false") return false
  if (!(s.length < 2)) {
    if (s.charCodeAt(0) === QUOTE_CHAR) {
      if (s.charCodeAt(s.length - 1) === QUOTE_CHAR) return s.slice(1, -1)
    }
  }
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?\d+\.\d+$/.test(s)) return Number(s)
  return s
}

function parseWhereTokens(whereClause) {
  if (!whereClause) return []
  const tokens = []
  const parts = String(whereClause).split(/\s+AND\s+/i).map(function (p) { return p.trim() }).filter(function (p) { return p })
  for (const part of parts) {
    const m = part.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (m) tokens.push({ column: m[1], value: coerceLiteral(m[2]) })
  }
  return tokens
}

function buildPredicate(tokens) {
  if (!tokens) return function () { return true }
  if (tokens.length === 0) return function () { return true }
  return function (row) {
    return tokens.every(function (t) { return row[t.column] === t.value })
  }
}

function parseStatement(sql) {
  const input = sql === null ? "" : (sql === undefined ? "" : String(sql))
  let s = input.trim()
  if (s.length === 0) return { type: "unknown", sql: s }
  if (s.charCodeAt(s.length - 1) === 59) s = s.slice(0, -1).trim()
  let m
  m = s.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)$/i)
  if (m) return { type: "createIndex", index: m[1], table: m[2], columns: m[3].split(",").map(function (c) { return c.trim() }) }
  m = s.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][\w]*)\s+ADD\s+(?:COLUMN\s+)?([A-Za-z_][\w]*)\s+(.+)$/i)
  if (m) return { type: "addColumn", table: m[1], column: m[2], datatype: m[3].trim() }
  m = s.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)$/i)
  if (m) {
    const cols = m[2].split(",").map(function (c) { return c.trim() })
    const vals = m[3].split(",").map(function (v) { return coerceLiteral(v.trim()) })
    return { type: "insert", table: m[1], columns: cols, values: vals }
  }
  m = s.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*VALUES\s*\(([^)]+)\)$/i)
  if (m) return { type: "insertValues", table: m[1], values: m[2].split(",").map(function (v) { return coerceLiteral(v.trim()) }) }
  m = s.match(/^UPDATE\s+([A-Za-z_][\w]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
  if (m) {
    const setParts = m[2].split(",").map(function (x) {
      const mm = x.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
      return mm ? { column: mm[1], value: coerceLiteral(mm[2]) } : null
    }).filter(function (x) { return x })
    return { type: "update", table: m[1], set: setParts, where: parseWhereTokens(m[3]) }
  }
  m = s.match(/^DELETE\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+(.+))?$/i)
  if (m) return { type: "delete", table: m[1], where: parseWhereTokens(m[2]) }
  m = s.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\((.+)\)$/i)
  if (m) return { type: "createTable", table: m[1], body: m[2] }
  return { type: "unknown", sql: s }
}

function assertSafeSql(sql) {
  const s = String(sql === null ? "" : (sql === undefined ? "" : String(sql))).trim()
  if (/^DROP\s+TABLE\b/i.test(s)) {
    throw new DbBranchError("DROP TABLE is blocked by migration guardrail", { code: "migration_blocked", reason: "drop_table" })
  }
  if (/^TRUNCATE\s+TABLE\b/i.test(s)) {
    throw new DbBranchError("TRUNCATE TABLE is blocked by migration guardrail", { code: "migration_blocked", reason: "truncate_table" })
  }
  if (/^UPDATE\b/i.test(s)) {
    if (!/\bWHERE\b/i.test(s)) {
      throw new DbBranchError("UPDATE without WHERE is blocked by migration guardrail", { code: "migration_blocked", reason: "destructive_without_where" })
    }
  }
  if (/^DELETE\b/i.test(s)) {
    if (!/\bWHERE\b/i.test(s)) {
      throw new DbBranchError("DELETE without WHERE is blocked by migration guardrail", { code: "migration_blocked", reason: "destructive_without_where" })
    }
  }
}

function extractTableFromSql(sql) {
  const s = String(sql === null ? "" : (sql === undefined ? "" : String(sql)))
  let m = s.match(/\bFROM\s+([A-Za-z_][\w]*)/i)
  if (m) return m[1]
  m = s.match(/\bON\s+([A-Za-z_][\w]*)/i)
  if (m) return m[1]
  m = s.match(/\bTABLE\s+([A-Za-z_][\w]*)/i)
  if (m) return m[1]
  m = s.match(/\bUPDATE\s+([A-Za-z_][\w]*)/i)
  if (m) return m[1]
  m = s.match(/\bINTO\s+([A-Za-z_][\w]*)/i)
  if (m) return m[1]
  return null
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

export class InMemoryDbBranchProvider {
  constructor(config) {
    this._config = config ?? {}
    this._branches = new Map()
    this._baseline = this._normalizeSnapshot(this._config.baseline)
  }

  _normalizeSnapshot(snapshot) {
    if (!snapshot) return { tables: new Map(), foreignKeys: [] }
    if (snapshot.tables instanceof Map) {
      const tables = new Map()
      for (const entry of snapshot.tables) {
        const name = entry[0]
        const def = entry[1]
        const columns = Array.isArray(def.columns) ? def.columns.slice() : []
        const pk = def.pk ?? "id"
        const rows = Array.isArray(def.rows) ? clone(def.rows) : []
        tables.set(name, { columns: columns, pk: pk, rows: rows })
      }
      const fks = Array.isArray(snapshot.foreignKeys) ? clone(snapshot.foreignKeys) : []
      return { tables: tables, foreignKeys: fks }
    }
    const tables = new Map()
    const foreignKeys = []
    const sourceTables = snapshot.tables ?? snapshot
    for (const name of Object.keys(sourceTables)) {
      const def = sourceTables[name]
      if (Array.isArray(def)) {
        const cols = def.length === 0 ? [] : Object.keys(def[0] ?? {})
        tables.set(name, { columns: cols, pk: "id", rows: clone(def) })
      } else if (isObject(def)) {
        const cols = Array.isArray(def.columns) ? def.columns.slice() : (Array.isArray(def.rows) ? (def.rows.length === 0 ? [] : Object.keys(def.rows[0] ?? {})) : [])
        const pk = def.pk ?? "id"
        const rows = Array.isArray(def.rows) ? clone(def.rows) : []
        tables.set(name, { columns: cols, pk: pk, rows: rows })
        if (Array.isArray(def.foreignKeys)) {
          for (const fk of def.foreignKeys) foreignKeys.push(clone(fk))
        }
      }
    }
    if (Array.isArray(snapshot.foreignKeys)) {
      for (const fk of snapshot.foreignKeys) foreignKeys.push(clone(fk))
    }
    return { tables: tables, foreignKeys: foreignKeys }
  }

  async createBranch(args) {
    const a = args ?? {}
    const branchId = a.branchId
    if (!branchId) throw new DbBranchError("branchId is required", { code: "invalid_argument" })
    if (this._branches.has(branchId)) throw new DbBranchError("branch already exists: " + branchId, { code: "branch_exists", branchId: branchId })
    const snap = this._normalizeSnapshot(a.baselineSnapshot ?? this._baseline)
    const branch = {
      branchId: branchId,
      tables: new Map(),
      foreignKeys: clone(snap.foreignKeys),
      indexes: new Map(),
      queryRewrites: new Map(),
      queryOptimizations: [],
      migrations: [],
      trafficReplays: [],
      lastReplay: null,
      createdAt: new Date().toISOString()
    }
    for (const entry of snap.tables) {
      const name = entry[0]
      const def = entry[1]
      branch.tables.set(name, { columns: def.columns.slice(), pk: def.pk, rows: clone(def.rows) })
    }
    this._branches.set(branchId, branch)
    return { branchId: branchId, tables: Array.from(branch.tables.keys()) }
  }

  async applyMigration(args) {
    const a = args ?? {}
    const branchId = a.branchId
    const branch = this._branches.get(branchId)
    if (!branch) throw new DbBranchError("unknown branch: " + branchId, { code: "unknown_branch", branchId: branchId })
    const script = a.script
    if (!script) throw new DbBranchError("migration script is required", { branchId: branchId })
    if (!Array.isArray(script.up)) throw new DbBranchError("migration script.up array is required", { branchId: branchId })
    for (const step of script.up) {
      assertSafeSql(step.sql ?? "")
    }
    const applied = []
    for (const step of script.up) {
      const result = this._applyStep(branch, step)
      applied.push({ type: step.type ?? "rawSQL", sql: step.sql ?? "", result: result })
    }
    branch.migrations.push({ up: script.up, applied: applied, appliedAt: new Date().toISOString() })
    return { branchId: branchId, applied: applied.length, steps: applied }
  }

  _applyStep(branch, step) {
    const type = step.type ?? "rawSQL"
    if (type === "addIndex") {
      const parsed = parseStatement(step.sql ?? "")
      if (parsed.type === "createIndex") {
        this._ensureIndex(branch, parsed.table, parsed.index, parsed.columns)
        return { action: "addIndex", table: parsed.table, index: parsed.index, columns: parsed.columns }
      }
      throw new DbBranchError("addIndex migration did not parse as CREATE INDEX: " + (step.sql ?? ""), { branchId: branch.branchId, code: "migration_parse_failed" })
    }
    if (type === "modifyQuery") {
      const parsed = parseStatement(step.sql ?? "")
      const table = step.table ?? parsed.table ?? extractTableFromSql(step.sql ?? "")
      if (table) {
        const list = branch.queryRewrites.get(table) ?? []
        list.push({ note: step.note ?? step.sql ?? "", sql: step.sql ?? "" })
        branch.queryRewrites.set(table, list)
      }
      branch.queryOptimizations.push({ table: table, sql: step.sql ?? "", kind: "modifyQuery" })
      return { action: "modifyQuery", table: table }
    }
    const parsed = parseStatement(step.sql ?? "")
    return this._applyParsed(branch, parsed)
  }

  _ensureIndex(branch, table, index, columns) {
    const idxMap = branch.indexes.get(table) ?? new Map()
    idxMap.set(index, { columns: columns })
    branch.indexes.set(table, idxMap)
  }

  _applyParsed(branch, parsed) {
    if (parsed.type === "createIndex") {
      this._ensureIndex(branch, parsed.table, parsed.index, parsed.columns)
      return { action: "addIndex", table: parsed.table, index: parsed.index, columns: parsed.columns }
    }
    if (parsed.type === "createTable") {
      const tdef = branch.tables.get(parsed.table)
      if (!tdef) {
        branch.tables.set(parsed.table, { columns: [], pk: "id", rows: [] })
      }
      return { action: "createTable", table: parsed.table }
    }
    if (parsed.type === "addColumn") {
      const tdef = branch.tables.get(parsed.table)
      if (tdef) {
        tdef.columns.push(parsed.column)
        for (const row of tdef.rows) {
          row[parsed.column] = null
        }
      }
      return { action: "addColumn", table: parsed.table, column: parsed.column }
    }
    if (parsed.type === "insert") {
      const tdef = branch.tables.get(parsed.table)
      if (tdef) {
        const row = {}
        let i = 0
        while (i < parsed.columns.length) {
          row[parsed.columns[i]] = parsed.values[i] ?? null
          i = i + 1
        }
        tdef.rows.push(row)
      }
      return { action: "insert", table: parsed.table, rows: 1 }
    }
    if (parsed.type === "insertValues") {
      const tdef = branch.tables.get(parsed.table)
      if (tdef) {
        const row = {}
        let i = 0
        while (i < tdef.columns.length) {
          row[tdef.columns[i]] = parsed.values[i] ?? null
          i = i + 1
        }
        tdef.rows.push(row)
      }
      return { action: "insert", table: parsed.table, rows: 1 }
    }
    if (parsed.type === "update") {
      const tdef = branch.tables.get(parsed.table)
      let affected = 0
      if (tdef) {
        const predicate = buildPredicate(parsed.where)
        for (const row of tdef.rows) {
          if (predicate(row)) {
            for (const s of parsed.set) {
              row[s.column] = s.value
            }
            affected = affected + 1
          }
        }
      }
      return { action: "update", table: parsed.table, affected: affected }
    }
    if (parsed.type === "delete") {
      const tdef = branch.tables.get(parsed.table)
      let affected = 0
      if (tdef) {
        const predicate = buildPredicate(parsed.where)
        const kept = []
        for (const row of tdef.rows) {
          if (predicate(row)) {
            affected = affected + 1
          } else {
            kept.push(row)
          }
        }
        tdef.rows = kept
      }
      return { action: "delete", table: parsed.table, affected: affected }
    }
    return { action: "noop", sql: parsed.sql }
  }

  async replayTraffic(args) {
    const a = args ?? {}
    const branchId = a.branchId
    const branch = this._branches.get(branchId)
    if (!branch) throw new DbBranchError("unknown branch: " + branchId, { code: "unknown_branch", branchId: branchId })
    const requests = a.requests
    if (!Array.isArray(requests)) throw new DbBranchError("requests array is required", { branchId: branchId })
    const results = []
    let totalMs = 0
    const durations = []
    for (const req of requests) {
      const r = this._replayOne(branch, req)
      results.push(r)
      totalMs = totalMs + r.durationMs
      durations.push(r.durationMs)
    }
    durations.sort(function (x, y) { return x - y })
    const p95 = percentile(durations, 0.95)
    const summary = {
      total: requests.length,
      ok: results.filter(function (r) { return r.ok }).length,
      failed: results.filter(function (r) { return !r.ok }).length,
      totalDurationMs: totalMs,
      avgMs: results.length === 0 ? 0 : Math.round(totalMs / results.length),
      p95Ms: p95
    }
    branch.trafficReplays.push({ requests: results.length, summary: summary })
    branch.lastReplay = summary
    return { branchId: branchId, results: results, summary: summary }
  }

  _replayOne(branch, req) {
    const op = String(req.op ?? "select").toLowerCase()
    const table = req.table
    const tdef = branch.tables.get(table)
    const rows = tdef ? tdef.rows : []
    if (op === "select") {
      const tokens = this._whereTokens(req.where)
      const predicate = buildPredicate(tokens)
      const matched = rows.filter(predicate)
      const offset = req.offset ?? 0
      const limit = req.limit ?? null
      let sliced
      if (limit === null) {
        sliced = matched
      } else {
        sliced = matched.slice(offset, offset + limit)
      }
      const latency = this._estimateLatency(branch, table, "select", rows.length, matched.length)
      return { ok: true, op: op, table: table, rows: sliced, count: matched.length, durationMs: latency }
    }
    if (op === "count") {
      const tokens = this._whereTokens(req.where)
      const predicate = buildPredicate(tokens)
      const matched = rows.filter(predicate)
      const latency = this._estimateLatency(branch, table, "count", rows.length, matched.length)
      return { ok: true, op: op, table: table, rows: [{ count: matched.length }], count: matched.length, durationMs: latency }
    }
    if (op === "insert") {
      const latency = this._estimateLatency(branch, table, "insert", rows.length, 1)
      if (tdef) {
        tdef.rows.push(clone(req.row ?? {}))
      }
      return { ok: true, op: op, table: table, inserted: 1, durationMs: latency }
    }
    if (op === "update") {
      const tokens = this._whereTokens(req.where)
      const predicate = buildPredicate(tokens)
      let affected = 0
      if (tdef) {
        for (const row of tdef.rows) {
          if (predicate(row)) {
            const set = req.set ?? {}
            for (const key of Object.keys(set)) {
              row[key] = set[key]
            }
            affected = affected + 1
          }
        }
      }
      const latency = this._estimateLatency(branch, table, "update", rows.length, affected)
      return { ok: true, op: op, table: table, affected: affected, durationMs: latency }
    }
    if (op === "delete") {
      const tokens = this._whereTokens(req.where)
      const predicate = buildPredicate(tokens)
      let affected = 0
      if (tdef) {
        const kept = []
        for (const row of tdef.rows) {
          if (predicate(row)) {
            affected = affected + 1
          } else {
            kept.push(row)
          }
        }
        tdef.rows = kept
      }
      const latency = this._estimateLatency(branch, table, "delete", rows.length, affected)
      return { ok: true, op: op, table: table, affected: affected, durationMs: latency }
    }
    const latency = this._estimateLatency(branch, table, op, rows.length, 0)
    return { ok: false, op: op, table: table, error: "unsupported op", durationMs: latency }
  }

  _whereTokens(where) {
    if (!where) return []
    if (Array.isArray(where)) return where
    if (typeof where === "string") return parseWhereTokens(where)
    if (isObject(where)) {
      const tokens = []
      for (const column of Object.keys(where)) {
        tokens.push({ column: column, value: where[column] })
      }
      return tokens
    }
    return []
  }

  _estimateLatency(branch, table, op, scanned, matched) {
    const n = scanned < 1 ? 1 : scanned
    let cost = Math.round(Math.log2(n + 2) * 2)
    if (cost < 1) cost = 1
    const hasIndex = branch.indexes.has(table)
    const hasRewrite = branch.queryRewrites.has(table)
    if (hasIndex) {
      cost = Math.round(Math.log2(Math.log2(n + 4) + 2) * 2)
      if (cost < 1) cost = 1
    }
    if (hasRewrite) {
      cost = Math.round(cost / 2)
      if (cost < 1) cost = 1
    }
    let writeExtra = 0
    if (op === "insert") {
      writeExtra = 2
    } else if (op === "update") {
      writeExtra = 2
    } else if (op === "delete") {
      writeExtra = 2
    }
    return cost + writeExtra + 1
  }

  async assertConsistency(args) {
    const a = args ?? {}
    const branchId = a.branchId
    const branch = this._branches.get(branchId)
    if (!branch) throw new DbBranchError("unknown branch: " + branchId, { code: "unknown_branch", branchId: branchId })
    const violations = []
    const checked = {}
    for (const entry of branch.tables) {
      const tname = entry[0]
      const tdef = entry[1]
      const pk = tdef.pk ?? "id"
      const seen = new Set()
      for (const row of tdef.rows) {
        const v = row[pk]
        const hasPk = !(v === null ? true : v === undefined)
        if (hasPk) {
          if (seen.has(v)) {
            violations.push({ type: "duplicate_pk", table: tname, pk: v })
          } else {
            seen.add(v)
          }
        } else {
          violations.push({ type: "null_pk", table: tname })
        }
      }
      checked[tname] = { rows: tdef.rows.length, pk: pk }
    }
    for (const fk of branch.foreignKeys) {
      const parent = branch.tables.get(fk.references)
      const child = branch.tables.get(fk.table)
      if (!parent) {
        violations.push({ type: "missing_fk_table", table: fk.table, references: fk.references })
        continue
      }
      if (!child) {
        violations.push({ type: "missing_fk_table", table: fk.table, references: fk.references })
        continue
      }
      const parentVals = new Set(parent.rows.map(function (r) { return r[fk.refColumn] }))
      for (const row of child.rows) {
        const v = row[fk.column]
        if (v === null) continue
        if (v === undefined) continue
        if (!parentVals.has(v)) {
          violations.push({ type: "fk_violation", table: fk.table, column: fk.column, value: v, references: fk.references })
        }
      }
      checked[fk.table + "." + fk.column] = { references: fk.references, refColumn: fk.refColumn }
    }
    return { branchId: branchId, consistent: violations.length === 0, violations: violations, checked: checked }
  }

  async compareBranches(args) {
    const a = args ?? {}
    const branchIds = a.branchIds
    const criteria = a.criteria ?? {}
    const metric = criteria.metric ?? "p95Ms"
    const lowerIsBetter = criteria.lowerIsBetter ?? true
    if (!Array.isArray(branchIds)) throw new DbBranchError("branchIds array is required")
    const entries = []
    for (const id of branchIds) {
      const b = this._branches.get(id)
      if (!b) throw new DbBranchError("unknown branch: " + id, { code: "unknown_branch", branchId: id })
      const replay = b.lastReplay ?? { total: 0, ok: 0, failed: 0, totalDurationMs: 0, avgMs: 0, p95Ms: 0 }
      const consistency = await this.assertConsistency({ branchId: id })
      const value = Number(replay[metric] ?? replay.p95Ms ?? 0)
      entries.push({ branchId: id, metric: metric, value: value, migrations: b.migrations.length, consistent: consistency.consistent, trafficOps: replay.total })
    }
    entries.sort(function (x, y) {
      if (lowerIsBetter) {
        return x.value - y.value
      }
      return y.value - x.value
    })
    let rank = 1
    for (const e of entries) {
      e.rank = rank
      rank = rank + 1
    }
    const winner = entries.length === 0 ? null : entries[0].branchId
    return { ranking: entries, winner: winner, criteria: { metric: metric, lowerIsBetter: lowerIsBetter }, comparedAt: new Date().toISOString() }
  }

  async destroyBranch(args) {
    const a = args ?? {}
    const branchId = a.branchId
    const existed = this._branches.delete(branchId)
    return { branchId: branchId, disposed: existed }
  }

  listBranches() {
    return Array.from(this._branches.keys())
  }
}

export class RemoteDbBranchProviderPlaceholder {
  constructor(provider, config) {
    this.provider = provider
    this.config = config
    this.degraded = true
    this.degradedReason = provider + " real wire protocol is not available in pure-node stdlib, falling back to in-memory simulation"
    this._inner = new InMemoryDbBranchProvider(config)
  }
  async createBranch(args, context) { return this._inner.createBranch(args, context) }
  async applyMigration(args, context) { return this._inner.applyMigration(args, context) }
  async replayTraffic(args, context) { return this._inner.replayTraffic(args, context) }
  async assertConsistency(args, context) { return this._inner.assertConsistency(args, context) }
  async compareBranches(args, context) { return this._inner.compareBranches(args, context) }
  async destroyBranch(args, context) { return this._inner.destroyBranch(args, context) }
  listBranches() { return this._inner.listBranches() }
}

export function createDbBranchProvider(options) {
  const opts = options ?? {}
  const provider = opts.provider ?? "memory"
  const config = opts.config ?? {}
  if (provider === "memory") return new InMemoryDbBranchProvider(config)
  if (provider === "polardb") return createRemotePlaceholder("polardb", config)
  if (provider === "postgresql") return createRemotePlaceholder("postgresql", config)
  throw new DbBranchError("unknown db branch provider: " + provider, { code: "unknown_provider" })
}

function createRemotePlaceholder(provider, config) {
  const creds = config.credentials ?? config
  const hasConnUrl = typeof creds.connectionUrl === "string" ? !(creds.connectionUrl.length === 0) : false
  const hasHost = typeof creds.host === "string" ? !(creds.host.length === 0) : false
  const hasUser = typeof creds.user === "string" ? !(creds.user.length === 0) : false
  const hasDb = typeof creds.database === "string" ? !(creds.database.length === 0) : false
  const hasCreds = hasConnUrl ? true : (hasHost ? (hasUser ? hasDb : false) : false)
  if (!hasCreds) {
    throw new DbBranchError(provider + " db branch provider requires credentials (connectionUrl or host/user/database)", { code: "provider_credentials_required" })
  }
  return new RemoteDbBranchProviderPlaceholder(provider, config)
}
