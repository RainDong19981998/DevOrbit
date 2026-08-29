import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const RUNS_DIR = new URL(process.env.DEVORBIT_BENCH_RUNS_DIR || 'evaluation/public-benchmark/runs/', root);
const RESULTS_PATH = new URL(process.env.DEVORBIT_BENCH_RESULTS || 'evaluation/public-benchmark-results.json', root);
const OUT_PATH = new URL('knowledge/benchmark-episodes.json', root);

const sha = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

function classify(detail, error, status) {
  const text = `${detail || ''} ${error || ''}`;
  if (status === 'skipped' || /baseline FAIL_TO_PASS already green|environment/i.test(text)) return 'environment-mismatch';
  if (/dependency install failed|source extract failed/i.test(text)) return 'environment-mismatch';
  if (/unparseable|no JSON|budget exhausted|timeout/i.test(text)) return 'output-format-or-budget';
  if (/path policy violation/i.test(text)) return 'attempted-test-file-edit';
  if (/search block not found/i.test(text)) return 'search-block-mismatch';
  if (/source not loaded/i.test(text)) return 'wrong-or-missing-path';
  if (/F2P red/i.test(text)) return 'fix-logic-incomplete';
  if (/no valid edits/i.test(text)) return 'no-edits-produced';
  return 'other';
}

const LESSON_TEMPLATES = {
  'environment-mismatch': '该案例在固定评测环境中无法复现基线失败（依赖安装失败、源码解包失败或基线已绿）。属于环境不匹配而非修复能力问题；应按排除项披露，不投入返工预算。',
  'output-format-or-budget': '模型输出不可解析或超出调用预算。说明一次性直出大段内容不可靠；应缩短单次输出、改用小块 search/replace 编辑并严格约束 JSON 结构。',
  'attempted-test-file-edit': '修复尝试改动了测试文件，被安全门禁拦截。修复只能作用于源码文件；把失败测试当作需求而非可改对象。',
  'search-block-mismatch': 'search 块与文件真实内容不一致导致编辑无法应用。必须从 target-file 证据中逐字复制 search 块（含缩进与空白），不要凭记忆改写或猜测代码。',
  'wrong-or-missing-path': '编辑指向了不存在或未加载的路径。应使用 repo map 与 RCA 给出的仓库相对路径，先确认文件存在再编辑。',
  'fix-logic-incomplete': '编辑成功应用且无回归（P2P 绿），但目标失败测试（F2P）仍红，说明修复逻辑未覆盖根因。应结合失败测试输出定位遗漏分支，二次生成时只补差异。',
  'no-edits-produced': '模型未产出有效编辑。应在提示中明确要求 edits 数组，并给出目标文件内容作为锚点。'
};

const buckets = new Map();
const caseDirs = existsSync(RUNS_DIR) ? await readdir(RUNS_DIR) : [];
for (const instanceDir of caseDirs) {
  const instancePath = new URL(`${instanceDir}/`, RUNS_DIR);
  let files = [];
  try { files = await readdir(instancePath); } catch { continue; }
  for (const file of files.filter(f => f.endsWith('.json'))) {
    const method = file.replace('.json', '');
    let detail;
    try { detail = JSON.parse(await readFile(new URL(file, instancePath), 'utf8')); } catch { continue; }
    const evaluation = detail.evaluation || {};
    const status = evaluation.closedLoop === true ? 'closed' : (evaluation.detail ? 'completed' : 'unknown');
    const mode = classify(evaluation.detail, detail.error, detail.status || status);
    if (evaluation.closedLoop === true) continue;
    const repo = (detail.goldFiles && detail.goldFiles[0] ? '' : '') || instanceDir.split('__')[0].replace(/-/g, '/') && '';
    const repoGuess = detail.caseId ? '' : '';
    const key = `${instanceDir}::${mode}`;
    if (!buckets.has(key)) buckets.set(key, { instanceDir, mode, cases: new Set(), methods: new Set(), samples: [] });
    const bucket = buckets.get(key);
    bucket.cases.add(detail.caseId || instanceDir);
    bucket.methods.add(method);
    if (bucket.samples.length < 2) bucket.samples.push((evaluation.detail || detail.error || '').slice(0, 200));
  }
}

const resultsMeta = existsSync(RESULTS_PATH) ? JSON.parse(await readFile(RESULTS_PATH, 'utf8')) : null;
const repoByCase = new Map();
if (resultsMeta) {
  for (const run of resultsMeta.runs || []) {
    const instance = run.caseId.replace(/^PUB-/, '').toLowerCase();
    repoByCase.set(instance, run.repo || null);
  }
}
const manifest = JSON.parse(await readFile(new URL('evaluation/public-benchmark.manifest.json', root), 'utf8'));
const repoByInstance = new Map(manifest.cases.map(caseItem => [caseItem.caseId.slice(4).toLowerCase(), caseItem.repository]));

const episodes = [];
for (const bucket of buckets.values()) {
  const instance = bucket.instanceDir;
  const repo = repoByInstance.get(instance.toLowerCase()) || 'unknown-repo';
  const lesson = LESSON_TEMPLATES[bucket.mode] || `基准失败模式 ${bucket.mode}，需在下一轮避免。`;
  const episode = {
    id: `BENCH-EP-${sha(`${instance}:${bucket.mode}`)}`,
    title: `公开基准失败模式：${bucket.mode}（${repo}）`,
    summary: `在 ${repo} 的冻结基准案例上观察到 ${bucket.mode} 失败模式，涉及 ${[...bucket.cases].join(', ')}。${lesson}`,
    pattern: bucket.mode,
    tags: ['public-benchmark', repo, bucket.mode],
    tenant: 'public-benchmark',
    service: repo,
    environment: 'benchmark',
    evidence: bucket.samples,
    negativeLessons: [{ description: lesson }],
    recallStatus: 'negative',
    confidence: 'medium',
    source: { runsDir: RUNS_DIR.pathname, methods: [...bucket.methods] },
    createdAt: new Date().toISOString()
  };
  episodes.push(episode);
}

episodes.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(OUT_PATH, JSON.stringify(episodes, null, 2) + '\n');
const byMode = {};
for (const ep of episodes) byMode[ep.pattern] = (byMode[ep.pattern] || 0) + 1;
console.log(`PASS benchmark knowledge: ${episodes.length} negative episodes -> ${OUT_PATH.pathname}`);
console.log('modes:', JSON.stringify(byMode));
