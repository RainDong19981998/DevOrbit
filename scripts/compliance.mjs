import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url);
const roots = ['README.md', 'LICENSE', 'app', 'config', 'docs', 'schemas', 'scripts', 'skills', 'third_party', 'worker-packages', 'src', 'fixtures', 'knowledge', 'evaluation', 'reports', 'server.js', 'package.json'];
const forbidden = [String.fromCodePoint(20013, 22269, 31227, 21160), String.fromCodePoint(28789, 30079)];
const readable = new Set(['', '.md', '.html', '.css', '.js', '.mjs', '.json', '.yaml', '.yml', '.txt']);
let failed = false;

async function scan(path) {
  const url = new URL(path, root);
  const entries = await readdir(url, { withFileTypes: true }).catch(() => null);
  if (entries) {
    for (const entry of entries) await scan(join(path, entry.name));
    return;
  }
  if (!readable.has(extname(path))) return;
  const content = await readFile(url, 'utf8');
  for (const word of forbidden) if (content.includes(word)) {
    console.error(`FAIL forbidden term in ${relative('.', path)}`);
    failed = true;
  }
}

for (const item of roots) await scan(item);
if (failed) process.exit(1);
console.log('PASS content compliance scan');
