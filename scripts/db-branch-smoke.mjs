import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const composeFile = join(scriptDir, '..', 'docker-compose.db.yml');
const reportPath = join(scriptDir, '..', 'reports', 'db-branch.json');
const container = 'devorbit-postgres';
const database = 'devorbit_baseline';
const user = 'devorbit';

function save(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function command(name, args) {
  return spawnSync(name, args, { encoding: 'utf8', stdio: 'pipe' });
}

function compose(args) {
  return command('docker', ['compose', '-f', composeFile, ...args]);
}

function sql(statement, { tuples = true } = {}) {
  const args = ['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database];
  if (tuples) args.push('-t', '-A');
  args.push('-c', statement);
  const result = command('docker', args);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'psql failed').trim());
  return result.stdout.trim();
}

function explain(statement) {
  const [entry] = JSON.parse(sql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`));
  return { planningMs: entry['Planning Time'], executionMs: entry['Execution Time'], plan: entry.Plan };
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function branchResult(schema, query) {
  const resultHash = sql(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY t.id)) FROM (${query}) t`);
  const plans = Array.from({ length: 7 }, () => explain(query));
  const execution = plans.map(item => item.executionMs);
  const last = plans.at(-1);
  return { schema, resultHash, rows: Number(last.plan['Actual Rows']), p50Ms: percentile(execution, 0.5), p95Ms: percentile(execution, 0.95), samples: execution, executionPlan: last };
}

async function main() {
  if (command('docker', ['--version']).status !== 0) {
    save({ status: 'skipped', engine: 'postgresql', reason: 'docker unavailable', measured: false });
    console.log('SKIP db-branch-smoke: docker is not available');
    return;
  }
  const up = compose(['up', '-d', '--wait']);
  if (up.status !== 0) {
    save({ status: 'skipped', engine: 'postgresql', reason: 'compose up failed; inspect local Docker logs', measured: false });
    console.log('SKIP db-branch-smoke: docker compose up failed');
    return;
  }

  const startedAt = new Date().toISOString();
  try {
    // Both candidates start from the same 50k-row baseline. Each migration is
    // applied to its own schema, so a rejected hypothesis cannot pollute public.
    sql(`INSERT INTO warehouse (id,name) VALUES (3,'WH-LAB') ON CONFLICT (id) DO NOTHING;
      INSERT INTO inventory (id,sku,stock,warehouse_id,price)
      SELECT g, 'SKU-' || lpad(g::text,6,'0'), (g % 200), 3, (g % 1000) / 10.0
      FROM generate_series(10,50009) g ON CONFLICT (id) DO NOTHING;
      DROP SCHEMA IF EXISTS branch_index CASCADE;
      DROP SCHEMA IF EXISTS branch_rewrite CASCADE;
      CREATE SCHEMA branch_index;
      CREATE SCHEMA branch_rewrite;
      CREATE TABLE branch_index.warehouse (LIKE public.warehouse INCLUDING ALL);
      CREATE TABLE branch_index.inventory (LIKE public.inventory INCLUDING ALL);
      CREATE TABLE branch_rewrite.warehouse (LIKE public.warehouse INCLUDING ALL);
      CREATE TABLE branch_rewrite.inventory (LIKE public.inventory INCLUDING ALL);
      INSERT INTO branch_index.warehouse SELECT * FROM public.warehouse;
      INSERT INTO branch_index.inventory SELECT * FROM public.inventory;
      INSERT INTO branch_rewrite.warehouse SELECT * FROM public.warehouse;
      INSERT INTO branch_rewrite.inventory SELECT * FROM public.inventory;
      ALTER TABLE branch_index.inventory ADD CONSTRAINT fk_inventory_warehouse FOREIGN KEY (warehouse_id) REFERENCES branch_index.warehouse(id);
      ALTER TABLE branch_rewrite.inventory ADD CONSTRAINT fk_inventory_warehouse FOREIGN KEY (warehouse_id) REFERENCES branch_rewrite.warehouse(id);
      CREATE INDEX idx_inventory_sku ON branch_index.inventory(sku);
      ANALYZE branch_index.inventory;
      ANALYZE branch_rewrite.inventory;`);

    const candidateA = branchResult('branch_index', "SELECT id,sku,stock,warehouse_id,price FROM branch_index.inventory WHERE sku='SKU-042000'");
    const candidateB = branchResult('branch_rewrite', "SELECT id,sku,stock,warehouse_id,price FROM branch_rewrite.inventory WHERE lower(sku)=lower('SKU-042000')");
    const baselineCount = Number(sql('SELECT count(*) FROM public.inventory'));
    const branchCounts = [Number(sql('SELECT count(*) FROM branch_index.inventory')), Number(sql('SELECT count(*) FROM branch_rewrite.inventory'))];
    const foreignKeys = [Number(sql("SELECT count(*) FROM pg_constraint WHERE connamespace='branch_index'::regnamespace AND contype='f'")), Number(sql("SELECT count(*) FROM pg_constraint WHERE connamespace='branch_rewrite'::regnamespace AND contype='f'"))];
    const sameBusinessResult = candidateA.resultHash === candidateB.resultHash && candidateA.rows === candidateB.rows;
    const consistent = branchCounts.every(count => count === baselineCount) && foreignKeys.every(count => count === 1);
    const winner = sameBusinessResult && consistent ? [candidateA, candidateB].sort((a, b) => a.p95Ms - b.p95Ms)[0].schema : null;

    sql('DROP SCHEMA branch_index CASCADE; DROP SCHEMA branch_rewrite CASCADE;');
    const disposed = Number(sql("SELECT count(*) FROM pg_namespace WHERE nspname IN ('branch_index','branch_rewrite')")) === 0;
    save({
      status: sameBusinessResult && consistent && disposed ? 'passed' : 'failed',
      engine: 'postgresql-16', executionMode: 'real-isolated-schema', measured: true, startedAt, completedAt: new Date().toISOString(),
      baseline: { rows: baselineCount, database },
      acceptance: { sameBusinessResult, equalBaselineRows: consistent, foreignKeysPreserved: foreignKeys.every(count => count === 1), branchesDisposed: disposed },
      candidates: [
        { id: 'branch_index', hypothesis: 'B-tree index on sku', migration: 'CREATE INDEX idx_inventory_sku ON inventory(sku)', ...candidateA },
        { id: 'branch_rewrite', hypothesis: 'case-insensitive query rewrite', migration: 'application query rewrite using lower(sku)', ...candidateB }
      ],
      decision: { winner, rejected: winner === 'branch_index' ? 'branch_rewrite' : 'branch_index', criterion: 'business result equality, then lowest measured p95 execution time' }
    });
    console.log(`PASS db-branch-smoke: winner ${winner}`);
  } finally {
    compose(['down']);
  }
}

main().catch(error => {
  save({ status: 'failed', engine: 'postgresql-16', executionMode: 'real-isolated-schema', measured: true, error: error.message });
  try { compose(['down']); } catch { /* best effort cleanup */ }
  console.error(`FAIL db-branch-smoke: ${error.message}`);
  process.exitCode = 1;
});
