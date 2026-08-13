import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const sourcePath = new URL('../config/agentteams.resources.json', import.meta.url);
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const outPath = resolve(valueAfter('--out') || new URL('../config/agentteams.yaml', import.meta.url).pathname);
const mcpUrl = valueAfter('--mcp-url') || process.env.MCP_URL || 'https://devorbit.example/mcp';
if (!/^https?:\/\//.test(mcpUrl)) throw new Error('MCP URL must be an absolute HTTP(S) URL');

const resources = JSON.parse(await readFile(sourcePath, 'utf8'));
for (const resource of resources) {
  for (const server of resource.spec?.mcpServers || []) {
    server.url = mcpUrl;
  }
}

const header = [
  '# Generated from config/agentteams.resources.json.',
  '# Contract: AgentTeams v1.2.2, commit 849182af8e017168a5a200a87b1062142caf462d.',
  '# Package ZIPs are uploaded separately with scripts/deploy_agentteams.sh.',
  ''
].join('\n');
const yaml = header + resources.map(resource => JSON.stringify(resource, null, 2)).join('\n---\n') + '\n';
await writeFile(outPath, yaml);
console.log(`PASS rendered ${resources.length} AgentTeams resources to ${outPath}`);
