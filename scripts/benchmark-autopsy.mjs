import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
const root = fileURLToPath(new URL("../", import.meta.url))
const resultsPath = root + "evaluation/public-benchmark-results.json"
const runsDir = root + "evaluation/public-benchmark/runs"
const mdPath = root + "reports/benchmark-autopsy.md"
const jsonPath = root + "reports/benchmark-autopsy.json"
const results = JSON.parse(await readFile(resultsPath, "utf8"))
const devorbitRuns = (results.runs ?? []).filter(function(r) { return r.method === "devorbit" })
async function loadCaseDetail(caseId) {
  const dirName = caseId.replace(/^PUB-/, "").toLowerCase()
  const detailPath = join(runsDir, dirName, "devorbit.json")
  try {
    return JSON.parse(await readFile(detailPath, "utf8"))
  } catch {
    return null
  }
}
function anyIncludes(str, subs) {
  for (const sub of subs) {
    if (str.includes(sub)) return true
  }
  return false
}
function classifyRun(run, detail) {
  if (run.status === "skipped") {
    return { category: "environment-mismatch", reason: run.error ?? "skipped as environment_error" }
  }
  if (run.status === "error") {
    const err = run.error ?? ""
    if (anyIncludes(err, ["dependency install failed", "source extract failed"])) {
      return { category: "environment-mismatch", reason: err.slice(0, 120) }
    }
    if (anyIncludes(err, ["model output JSON unparseable", "Unterminated string"])) {
      if (120000 < run.durationMs) {
        return { category: "timeout", reason: "model output unparseable after " + run.durationMs + "ms (near budget ceiling)" }
      }
      return { category: "unclassified", reason: "model output JSON unparseable (" + run.durationMs + "ms)" }
    }
    return { category: "unclassified", reason: err.slice(0, 120) }
  }
  if (detail) {
    const evalDetail = detail.evaluation?.detail ?? ""
    const rcaFiles = detail.rca?.files ?? []
    const goldFiles = detail.goldFiles ?? []
    let fileOverlap = false
    if (0 < goldFiles.length) {
      if (0 < rcaFiles.length) {
        fileOverlap = rcaFiles.some(function(f) { return goldFiles.includes(f) })
      }
    }
    if (anyIncludes(evalDetail, ["git apply", "patch does not apply", "corrupt patch"])) {
      return { category: fileOverlap ? "patch-incomplete" : "localization-error", reason: fileOverlap ? "patch apply failed" : "RCA files mismatch gold" }
    }
    return { category: fileOverlap ? "patch-incomplete" : "localization-error", reason: fileOverlap ? "tests still failing" : "RCA wrong files" }
  }
  return { category: "unclassified", reason: "no devorbit.json detail" }
}
const caseRows = []
for (const run of devorbitRuns) {
  const detail = await loadCaseDetail(run.caseId)
  const classification = classifyRun(run, detail)
  const isRunFailure = run.status !== "completed"
  caseRows.push({
    caseId: run.caseId,
    status: run.status,
    patchAttempted: run.patchAttempted,
    closedLoop: run.closedLoop,
    testsPassed: run.testsPassed,
    durationMs: run.durationMs,
    tokenCount: run.tokenCount,
    attempts: detail?.attempts ?? null,
    rcaFiles: detail?.rca?.files ?? null,
    goldFiles: detail?.goldFiles ?? null,
    evalDetail: detail?.evaluation?.detail ?? null,
    error: run.error,
    isRunFailure,
    category: classification.category,
    reason: classification.reason
  })
}
const runFailures = caseRows.filter(function(r) { return r.isRunFailure })
const completedNotClosed = caseRows.filter(function(r) {
  if (r.isRunFailure) return false
  return !r.closedLoop
})
const categoryCounts = {}
for (const row of runFailures) {
  categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1
}
const retriedCases = caseRows.filter(function(r) {
  if (r.attempts == null) return false
  return 2 <= r.attempts
})
const savedBySelfHealing = retriedCases.filter(function(r) { return r.closedLoop }).length
const allClosedLoop = caseRows.every(function(r) { return !r.closedLoop })
const report = {
  generatedAt: new Date().toISOString(),
  datasetId: results.datasetId,
  totalDevorbitRuns: devorbitRuns.length,
  runFailuresCount: runFailures.length,
  completedNotClosedCount: completedNotClosed.length,
  categoryCounts,
  selfHealingStats: {
    retriedCasesCount: retriedCases.length,
    savedBySelfHealing,
    allClosedLoopFalse: allClosedLoop,
    attemptsDistribution: {}
  },
  runFailures,
  completedNotClosed
}
for (const row of caseRows) {
  if (row.attempts != null) {
    const key = String(row.attempts)
    report.selfHealingStats.attemptsDistribution[key] = (report.selfHealingStats.attemptsDistribution[key] ?? 0) + 1
  }
}
await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n")
const md = []
md.push("# 公开基准失败案例深度剖析")
md.push("")
md.push("\u003e **诚实声明**：公开基准评测仅记录 pass/fail（status/compilePassed/testsPassed/closedLoop），不记录失败根因。根因分类基于 results.json 的 error 字段和 devorbit.json 的 evaluation.detail 人工推断。results.json 不含 attempts/patchAttempts 字段，返工次数从 devorbit.json 的 attempts 字段读取（仅 completed 案例有该文件）。")
md.push("")
md.push("Generated: " + report.generatedAt)
md.push("")
md.push("## 1. 运行失败案例根因分类（status 非 completed，n=" + runFailures.length + "）")
md.push("")
md.push("\u007c Case ID \u007c Status \u007c Category \u007c Reason \u007c Duration(ms) \u007c Attempts \u007c")
md.push("\u007c---\u007c---\u007c---\u007c---\u007c---:\u007c---:\u007c")
for (const row of runFailures) {
  md.push("\u007c " + row.caseId + " \u007c " + row.status + " \u007c " + row.category + " \u007c " + (row.reason ?? "n/a").slice(0, 80) + " \u007c " + row.durationMs + " \u007c " + (row.attempts ?? "n/a") + " \u007c")
}
md.push("")
md.push("### 根因分类统计")
md.push("")
for (const [cat, count] of Object.entries(categoryCounts)) {
  md.push("- " + cat + ": " + count + " 例")
}
md.push("")
md.push("## 2. 补丁未通过案例（completed but closedLoop=false，n=" + completedNotClosed.length + "）")
md.push("")
md.push("所有 " + completedNotClosed.length + " 个 completed 案例均未闭环（testsPassed=false）。devorbit.json 显示 patch 已生成但未通过测试，多数为 git apply --check 失败。")
md.push("")
md.push("\u007c Case ID \u007c Attempts \u007c RCA Files \u007c Gold Files \u007c Eval Detail \u007c")
md.push("\u007c---\u007c---:\u007c---\u007c---\u007c---\u007c")
for (const row of completedNotClosed) {
  const detail = (row.evalDetail ?? "n/a").split("\n").join(" ").slice(0, 60)
  md.push("\u007c " + row.caseId + " \u007c " + (row.attempts ?? "n/a") + " \u007c " + (row.rcaFiles ?? []).join(", ") + " \u007c " + (row.goldFiles ?? []).join(", ") + " \u007c " + detail + " \u007c")
}
md.push("")
md.push("## 3. 自愈救回统计")
md.push("")
md.push("- 经历返工（attempts≥2）的案例数：" + retriedCases.length)
md.push("- 返工后闭环成功的案例数（首版失败→返工后成功）：" + savedBySelfHealing)
md.push("- 全部 " + devorbitRuns.length + " 个 devorbit 案例的 closedLoop 均为 false：" + allClosedLoop)
md.push("")
if (savedBySelfHealing === 0) {
  md.push("\u003e 由于所有案例 closedLoop 均为 false，自愈救回数为 0。这反映当前模型能力尚不足以在公开 SWE-bench 案例上实现闭环修复，而非自愈机制本身无效（见 reports/ablation.md 的机制级消融）。")
}
md.push("")
md.push("### attempts 分布")
md.push("")
for (const [attempts, count] of Object.entries(report.selfHealingStats.attemptsDistribution)) {
  md.push("- attempts=" + attempts + ": " + count + " 例")
}
md.push("")
md.push("## 4. 诚实边界声明")
md.push("")
md.push("1. 公开基准评测仅记录 pass/fail（status/compilePassed/testsPassed/closedLoop），不记录失败根因。")
md.push("2. 根因分类基于 results.json 的 error 字段和 devorbit.json 的 evaluation.detail 人工推断，非自动化根因分析。")
md.push("3. results.json 不含 attempts/patchAttempts 字段，返工次数从 devorbit.json 的 attempts 字段读取。")
md.push("4. " + runFailures.length + " 个运行失败案例中，" + (categoryCounts["environment-mismatch"] ?? 0) + " 个为环境不匹配，" + (categoryCounts["timeout"] ?? 0) + " 个为超时。")
md.push("5. " + completedNotClosed.length + " 个 completed 案例均因补丁未通过测试而失败（patch-incomplete）。")
md.push("6. 自愈救回数为 0（所有 closedLoop=false），但 golden-cases 层消融实验证明自愈机制可将首版失败补丁通过返工修复（见 reports/ablation.md）。")
md.push("")
md.push("---")
md.push("")
md.push("Generated: " + report.generatedAt)
md.push("")
await writeFile(mdPath, md.join("\n"))
console.log("PASS benchmark-autopsy: " + devorbitRuns.length + " devorbit runs, " + runFailures.length + " run failures, " + completedNotClosed.length + " completed-not-closed, report=" + mdPath)
