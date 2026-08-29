import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const fixtureRoot = resolve(root, 'fixtures/checkout-service')
const reportsDir = resolve(root, 'reports')
const port = Number(process.env.CHAOS_PORT ?? process.env.PORT ?? 4173)
const base = 'http://127.0.0.1:' + port

function lines(arr) {
  return arr.join(String.fromCharCode(10))
}

const HEALTHY = {
  'src/redisPool.js': lines([
    'export const redisPoolConfig = {',
    '  poolSize: 80,',
    '  queueTimeoutMs: 800',
    '}',
    ''
  ]),
  'src/order.js': lines([
    'const ordersByKey = new Map()',
    '',
    'export function resetOrders() {',
    '  ordersByKey.clear()',
    '}',
    '',
    'export function createOrder({ idempotencyKey, payload }) {',
    '  const existing = ordersByKey.get(idempotencyKey)',
    '  if (existing) return { status: 409, order: existing }',
    '  const order = { id: `ORD-${ordersByKey.size + 1}`, payload }',
    '  ordersByKey.set(idempotencyKey, order)',
    '  return { status: 201, order }',
    '}',
    ''
  ])
}

const FAULTS = {
  'pool-shrink': {
    title: '连接池缩容（poolSize 80→8）',
    targets: {
      'src/redisPool.js': lines([
        'export const redisPoolConfig = {',
        '  poolSize: 8,',
        '  queueTimeoutMs: 800',
        '}',
        ''
      ])
    }
  },
  'idempotency-loss': {
    title: '幂等保护丢失（重复请求创建新订单）',
    targets: {
      'src/order.js': lines([
        'const ordersByKey = new Map()',
        '',
        'export function resetOrders() {',
        '  ordersByKey.clear()',
        '}',
        '',
        'export function createOrder({ idempotencyKey, payload }) {',
        '  const order = { id: `ORD-${ordersByKey.size + 1}`, payload }',
        '  ordersByKey.set(idempotencyKey, order)',
        '  return { status: 201, order }',
        '}',
        ''
      ])
    }
  },
  'slow-sql': {
    title: '慢 SQL（无索引全表扫描）',
    targets: {
      'src/order.js': lines([
        'const ordersByKey = new Map()',
        '',
        'export function resetOrders() {',
        '  ordersByKey.clear()',
        '}',
        '',
        'export function createOrder({ idempotencyKey, payload }) {',
        '  const existing = ordersByKey.get(idempotencyKey)',
        '  if (existing) return { status: 409, order: existing }',
        '  for (const key of ordersByKey.keys()) {',
        '    void ordersByKey.get(key)',
        '  }',
        '  const order = { id: `ORD-${ordersByKey.size + 1}`, payload }',
        '  ordersByKey.set(idempotencyKey, order)',
        '  return { status: 201, order }',
        '}',
        ''
      ])
    }
  }
}
function log(msg) {
  console.log(msg)
}

function git(args, opts) {
  var r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1048576 })
  if (r.error) throw r.error
  var allow = opts ? opts.allowFail : false
  if (r.status !== 0) {
    if (!allow) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr ?? r.stdout))
  }
  return (r.stdout ?? '').trim()
}

async function readFixture(file) {
  return readFile(resolve(fixtureRoot, file), 'utf8')
}

async function writeFixture(file, content) {
  return writeFile(resolve(fixtureRoot, file), content, 'utf8')
}

async function request(path, body) {
  var opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  var res = await fetch(base + path, opts)
  var data = await res.json()
  if (!res.ok) throw new Error(path + ': ' + res.status + ' ' + JSON.stringify(data))
  return data
}

async function serverReady() {
  try {
    var res = await fetch(base + '/api/health')
    if (!res.ok) return false
    var data = await res.json()
    return data.status === 'ok'
  } catch (e) {
    return false
  }
}

async function ensureServer(ctx) {
  if (await serverReady()) {
    log('  已检测到运行中的 server（' + base + '），复用')
    return
  }
  log('  启动 server.js（端口 ' + port + '）…')
  ctx.proc = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: Object.assign({}, process.env, { PORT: String(port), DEVORBIT_ENVIRONMENT: 'chaos' }),
    stdio: ['ignore', 'ignore', 'ignore']
  })
  ctx.startedByUs = true
  var ready = false
  var i = 0
  while (i < 80) {
    if (await serverReady()) {
      ready = true
      break
    }
    await delay(100)
    i = i + 1
  }
  if (!ready) throw new Error('server 未就绪（' + base + '/api/health 无响应）')
  log('  server 就绪')
}
async function snapshot() {
  var files = Object.keys(HEALTHY)
  var backup = {}
  for (const f of files) {
    backup[f] = await readFixture(f)
  }
  var head = git(['rev-parse', 'HEAD'])
  var relFiles = files.map(function (f) { return 'fixtures/checkout-service/' + f })
  var porcelain = git(['status', '--porcelain'].concat(relFiles), { allowFail: true })
  return { backup: backup, head: head, porcelain: porcelain }
}

async function applyBaseline() {
  for (const f of Object.keys(HEALTHY)) {
    await writeFixture(f, HEALTHY[f])
  }
}

async function injectFault(fault) {
  for (const f of Object.keys(fault.targets)) {
    await writeFixture(f, fault.targets[f])
  }
}

async function restore(snap) {
  for (const f of Object.keys(snap.backup)) {
    await writeFixture(f, snap.backup[f])
  }
  var files = Object.keys(snap.backup)
  var verified = {}
  for (const f of files) {
    var after = await readFixture(f)
    verified[f] = after === snap.backup[f]
  }
  var allVerified = Object.keys(verified).every(function (f) { return verified[f] })
  var relFiles = files.map(function (f) { return 'fixtures/checkout-service/' + f })
  var porcelainAfter = git(['status', '--porcelain'].concat(relFiles), { allowFail: true })
  return { verified: allVerified, files: verified, gitClean: porcelainAfter === '' }
}

async function runLoop() {
  var pending = await request('/api/runs', { scenario: 'happy-path' })
  var result = pending
  var steps = { pending: pending.state.status }
  if (pending.state.status === 'approval_pending') {
    result = await request('/api/runs/' + pending.state.caseId + '/approval', { decision: 'approved' })
    steps.afterApproval = result.state.status
  }
  return { pending: pending, result: result, steps: steps }
}

function present(fault, loop) {
  var r = loop.result
  var detect = r.canonical ? r.canonical.title + ' (confidence ' + r.canonical.confidence + ', ' + r.canonical.sources + ' sources)' : 'N/A'
  var topCause = r.rca ? (r.rca.causes ? r.rca.causes[0] : null) : null
  var diagnose = topCause ? topCause.statement + ' (score ' + topCause.score + ')' : 'N/A'
  var fix = r.plan ? r.plan.summary + ' (attempts ' + r.plan.attempts + '/' + r.plan.maxAttempts + ')' : 'N/A'
  var verify = r.tests ? r.tests.gate + ' (' + r.tests.passed + ' passed, ' + r.tests.failed + ' failed)' : 'N/A'
  var release = r.release ? r.release.decision + ' (canary ' + r.release.canary + ')' : 'N/A'
  var learn = r.knowledge ? r.knowledge.episodeId + ' (recovered=' + r.knowledge.observation.recovered + ')' : 'N/A'
  log('')
  log('  闭环阶段：')
  log('    [检测] ' + detect)
  log('    [诊断] ' + diagnose)
  log('    [修复] ' + fix)
  log('    [验证] ' + verify)
  log('    [发布] ' + release)
  log('    [知识] ' + learn)
  log('')
  log('  状态: ' + r.state.status + ' :: closedLoop=' + r.metrics.closedLoop + ' :: outcome=' + r.metrics.outcome)
  return { detect: detect, diagnose: diagnose, fix: fix, verify: verify, release: release, learn: learn }
}
async function freezeReport(data) {
  var r = data.loop ? data.loop.result : null
  var report = {
    fault: data.faultName,
    title: data.fault.title,
    injectedAt: data.injectedAt,
    restoredAt: data.restoredAt,
    gitHead: data.snap ? data.snap.head : null,
    targets: Object.keys(data.fault.targets),
    serverStarted: data.serverStarted,
    loop: r ? {
      caseId: r.state.caseId,
      traceId: r.state.traceId,
      status: r.state.status,
      closedLoop: r.metrics.closedLoop,
      outcome: r.metrics.outcome,
      patchAttempts: r.metrics.patchAttempts,
      tests: r.tests ? { gate: r.tests.gate, passed: r.tests.passed, failed: r.tests.failed } : null,
      release: r.release ? { decision: r.release.decision } : null,
      knowledge: r.knowledge ? { episodeId: r.knowledge.episodeId, recovered: r.knowledge.observation.recovered } : null,
      stages: data.stages
    } : null,
    restoration: {
      verified: data.restoration.verified,
      gitClean: data.restoration.gitClean,
      files: data.restoration.files
    },
    error: data.error ? data.error.message : null
  }
  await mkdir(reportsDir, { recursive: true })
  await writeFile(resolve(reportsDir, 'chaos.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10), 'utf8')
  log('  报告: reports/chaos.json')
}
async function main() {
  var injectArg = process.argv.find(function (a) { return a.indexOf('--inject=') === 0 })
  var faultNames = Object.keys(FAULTS)
  var faultName
  if (injectArg) {
    faultName = injectArg.split('=')[1]
    if (!FAULTS[faultName]) {
      throw new Error('未知故障: ' + faultName + '；可用: ' + faultNames.join(', '))
    }
  } else {
    faultName = faultNames[Math.floor(Math.random() * faultNames.length)]
  }
  var fault = FAULTS[faultName]
  var injectedAt = new Date().toISOString()
  var targetFiles = Object.keys(fault.targets)

  log('')
  log('══════════════════════════════════════════════')
  log('  DevOrbit Chaos Button — 现场故障注入演示')
  log('══════════════════════════════════════════════')
  log('  故障库: ' + faultNames.join(' / '))
  log('  选中故障: ' + faultName + ' — ' + fault.title)
  log('')

  var ctx = { proc: null, startedByUs: false }
  var snap = null
  var loop = null
  var stages = null
  var error = null

  try {
    log('[1/6] 记录恢复点')
    snap = await snapshot()
    log('  git HEAD: ' + snap.head.slice(0, 12))
    log('  备份 fixture 文件: ' + Object.keys(snap.backup).join(', '))

    log('[2/6] 重置 fixture 至健康基线')
    await applyBaseline()
    log('  src/redisPool.js → 健康 (poolSize=80, queueTimeoutMs=800)')
    log('  src/order.js → 健康 (幂等保护就绪)')

    log('[3/6] 现场注入故障')
    await injectFault(fault)
    var targetList = Object.keys(fault.targets)
    for (const f of targetList) {
      log('  ' + f + ' → ' + fault.title)
    }

    log('[4/6] 启动/连接 server')
    await ensureServer(ctx)

    log('[5/6] 跑完整闭环（happy-path）')
    loop = await runLoop()
    log('  POST /api/runs → ' + loop.steps.pending)
    if (loop.steps.afterApproval) {
      log('  POST /approval → ' + loop.steps.afterApproval)
    }
    stages = present(fault, loop)

    log('[6/6] 恢复 fixture 仓')
  } catch (e) {
    error = e
    log('  ✗ 异常: ' + e.message)
  } finally {
    var restoredAt = new Date().toISOString()
    var restoration = { verified: false, files: {}, gitClean: false }
    if (snap) {
      try {
        restoration = await restore(snap)
        var fileList = Object.keys(restoration.files)
        for (const f of fileList) {
          log('  ' + f + ' → ' + (restoration.files[f] ? '已恢复' : '恢复失败'))
        }
        log('  git status: ' + (restoration.gitClean ? 'clean' : 'modified'))
      } catch (e) {
        log('  恢复异常: ' + e.message)
      }
    }
    if (ctx.startedByUs) {
      if (ctx.proc) {
        try {
          ctx.proc.kill('SIGTERM')
          log('  server 已关闭')
        } catch (e) {}
      }
    }
    log('')
    if (loop) {
      if (loop.result) {
        log('  闭环状态: ' + loop.result.state.status + ' (closedLoop=' + loop.result.metrics.closedLoop + ')')
      } else {
        log('  闭环状态: 未完成')
      }
    } else {
      log('  闭环状态: 未完成')
    }
    log('')
    await freezeReport({ faultName: faultName, fault: fault, injectedAt: injectedAt, restoredAt: restoredAt, snap: snap, loop: loop, stages: stages, restoration: restoration, serverStarted: ctx.startedByUs, error: error })
  }

  if (error) process.exit(1)
}

main().catch(function (e) {
  console.error('chaos fatal:', e)
  process.exit(1)
})
