import { readFile, writeFile } from 'node:fs/promises';
import { KnowledgeStore } from '../src/knowledge/store.js';
import { HybridKnowledgeStore } from '../src/knowledge/hybrid-store.js';
import { createEmbeddingProvider } from '../src/models/embedding.js';

const cases = JSON.parse(await readFile(new URL('../evaluation/rag-cases.json', import.meta.url), 'utf8'));
const knowledgeCards = JSON.parse(await readFile(new URL('../knowledge/cases.json', import.meta.url), 'utf8'));

function evaluateStore(store, label) {
  return cases.map(item => {
    const results = store.search ? (store.search.length > 1 ? null : null) : null;
    return item;
  });
}

async function runEval(store, label) {
  const rows = [];
  for (const item of cases) {
    const results = await store.search({ query: item.query, tags: item.tags || [], topK: 3 });
    rows.push({ ...item, actualTop1: results[0]?.id || null, citation: results[0]?.citation || null, score: results[0]?.score || 0, combinedScore: results[0]?.combinedScore ?? null, vecScore: results[0]?.vecScore ?? null, passed: results[0]?.id === item.expectedTop1 && results[0]?.citation === `knowledge://${item.expectedTop1}` });
  }
  const passed = rows.filter(row => row.passed).length;
  return { label, rows, passed, total: rows.length, top1Accuracy: passed / rows.length, citationRate: rows.filter(row => Boolean(row.citation)).length / rows.length };
}

const lexicalStore = new KnowledgeStore(knowledgeCards);
const embeddingProvider = createEmbeddingProvider({ driver: process.env.DEVORBIT_EMBEDDING_DRIVER || 'local-hash', apiKey: process.env.DASHSCOPE_API_KEY, baseUrl: process.env.DEVORBIT_MODEL_BASE_URL });
const hybridStore = new HybridKnowledgeStore(knowledgeCards, embeddingProvider, 0.5);

const lexicalResult = await runEval(lexicalStore, 'lexical');
const hybridResult = await runEval(hybridStore, 'hybrid');

const summary = {
  dataset: 'DevOrbit Synthetic RAG Cases v0.1',
  disclosure: 'Team-authored synthetic queries and knowledge cards; not a production retrieval benchmark. Hybrid retrieval uses a local-hash deterministic embedding fallback when no API key is configured, and the Alibaba Cloud DashScope text-embedding-v4 endpoint when DASHSCOPE_API_KEY is set.',
  methods: [
    { label: lexicalResult.label, top1Accuracy: lexicalResult.top1Accuracy, citationRate: lexicalResult.citationRate, passed: lexicalResult.passed, total: lexicalResult.total },
    { label: hybridResult.label, top1Accuracy: hybridResult.top1Accuracy, citationRate: hybridResult.citationRate, passed: hybridResult.passed, total: hybridResult.total }
  ],
  cases: cases.length,
  lexicalTop1Accuracy: lexicalResult.top1Accuracy,
  hybridTop1Accuracy: hybridResult.top1Accuracy,
  citationRate: lexicalResult.citationRate
};

const allRows = cases.map((item, i) => ({ ...item, lexical: { top1: lexicalResult.rows[i].actualTop1, score: lexicalResult.rows[i].score, passed: lexicalResult.rows[i].passed }, hybrid: { top1: hybridResult.rows[i].actualTop1, score: hybridResult.rows[i].score, combinedScore: hybridResult.rows[i].combinedScore, vecScore: hybridResult.rows[i].vecScore, passed: hybridResult.rows[i].passed } }));

await writeFile(new URL('../reports/rag-evaluation.json', import.meta.url), JSON.stringify({ summary, cases: allRows }, null, 2) + '\n');
await writeFile(new URL('../reports/rag-evaluation.md', import.meta.url), `# DevOrbit 仿真 RAG 评测\n\n> ${summary.disclosure}\n\n| 方法 | Top-1 准确率 | 引用有效率 | 通过 |\n|---|---:|---:|---:|\n| ${lexicalResult.label}（词法） | ${(lexicalResult.top1Accuracy * 100).toFixed(1)}% | ${(lexicalResult.citationRate * 100).toFixed(1)}% | ${lexicalResult.passed}/${lexicalResult.total} |\n| ${hybridResult.label}（词法×0.5+向量×0.5） | ${(hybridResult.top1Accuracy * 100).toFixed(1)}% | ${(hybridResult.citationRate * 100).toFixed(1)}% | ${hybridResult.passed}/${hybridResult.total} |\n\n| Case | 预期 | 词法 Top-1 | 混合 Top-1 | 混合 combinedScore | 词法结果 | 混合结果 |\n|---|---|---|---|---:|---|---|\n${allRows.map(row => `| ${row.id} | ${row.expectedTop1} | ${row.lexical.top1} | ${row.hybrid.top1} | ${row.hybrid.combinedScore ?? 'n/a'} | ${row.lexical.passed ? 'PASS' : 'FAIL'} | ${row.hybrid.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n`);
console.log(`PASS RAG: lexical ${lexicalResult.passed}/${lexicalResult.total}; hybrid ${hybridResult.passed}/${hybridResult.total}`);
if (lexicalResult.passed !== lexicalResult.total || hybridResult.passed !== hybridResult.total) process.exit(1);
