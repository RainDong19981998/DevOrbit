import { readFile, writeFile } from 'node:fs/promises';
import { KnowledgeStore } from '../src/knowledge/store.js';

const cases = JSON.parse(await readFile(new URL('../evaluation/rag-cases.json', import.meta.url), 'utf8'));
const store = new KnowledgeStore();
const rows = cases.map(item => {
  const results = store.search({ query: item.query, tags: item.tags, topK: 3 });
  return { ...item, actualTop1: results[0]?.id || null, citation: results[0]?.citation || null, score: results[0]?.score || 0, passed: results[0]?.id === item.expectedTop1 && results[0]?.citation === `knowledge://${item.expectedTop1}` };
});
const summary = { dataset: 'DevOrbit Synthetic RAG Cases v0.1', disclosure: 'Team-authored synthetic queries and knowledge cards; not a production retrieval benchmark.', cases: rows.length, passed: rows.filter(row => row.passed).length, top1Accuracy: rows.filter(row => row.passed).length / rows.length, citationRate: rows.filter(row => Boolean(row.citation)).length / rows.length };
await writeFile(new URL('../reports/rag-evaluation.json', import.meta.url), JSON.stringify({ summary, cases: rows }, null, 2));
await writeFile(new URL('../reports/rag-evaluation.md', import.meta.url), `# DevOrbit 仿真 RAG 评测\n\n> ${summary.disclosure}\n\n| 指标 | 结果 |\n|---|---:|\n| 不同故障模式 | ${summary.cases} |\n| Top-1 准确率 | ${(summary.top1Accuracy * 100).toFixed(1)}% |\n| 引用有效率 | ${(summary.citationRate * 100).toFixed(1)}% |\n\n| Case | 预期 | 实际 | 得分 | 结果 |\n|---|---|---|---:|---|\n${rows.map(row => `| ${row.id} | ${row.expectedTop1} | ${row.actualTop1} | ${row.score} | ${row.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n`);
console.log(`PASS RAG Top-1 ${summary.passed}/${summary.cases}; citations ${(summary.citationRate * 100).toFixed(0)}%`);
if (summary.passed !== summary.cases) process.exit(1);
