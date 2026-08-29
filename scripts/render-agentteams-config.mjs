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
const modelOverride = valueAfter('--model') || process.env.AGENTTEAMS_MODEL_OVERRIDE || '';
const runtimeOverride = valueAfter('--runtime') || process.env.AGENTTEAMS_RUNTIME_OVERRIDE || '';
const adminUserOverride = valueAfter('--admin-user') || process.env.AGENTTEAMS_ADMIN_USER_OVERRIDE || '';
if (!/^https?:\/\//.test(mcpUrl)) throw new Error('MCP URL must be an absolute HTTP(S) URL');
if (runtimeOverride && !['openclaw', 'copaw', 'qwenpaw', 'hermes'].includes(runtimeOverride)) {
  throw new Error('AgentTeams runtime override must be openclaw, copaw, qwenpaw, or hermes');
}
if (adminUserOverride && !/^[a-z0-9][a-z0-9._=-]{0,254}$/.test(adminUserOverride)) {
  throw new Error('AgentTeams admin user override must be a Matrix localpart');
}

const resources = JSON.parse(await readFile(sourcePath, 'utf8'));
for (const resource of resources) {
  if (resource.kind === 'Worker') {
    if (modelOverride) resource.spec.model = modelOverride;
    if (runtimeOverride) resource.spec.runtime = runtimeOverride;
  }
  if (resource.kind === 'Team' && adminUserOverride) {
    const policy = resource.spec.channelPolicy || {};
    resource.spec.channelPolicy = {
      ...policy,
      groupAllowExtra: [...new Set([...(policy.groupAllowExtra || []), adminUserOverride])],
      dmAllowExtra: [...new Set([...(policy.dmAllowExtra || []), adminUserOverride])]
    };
  }
  for (const server of resource.spec?.mcpServers || []) {
    server.url = mcpUrl;
  }
}

const header = [
  '# Generated from config/agentteams.resources.json.',
  '# Contract: AgentTeams v1.2.2, commit 849182af8e017168a5a200a87b1062142caf462d.',
  '# Package ZIPs are uploaded separately with scripts/deploy_agentteams.sh.',
  ...(modelOverride || runtimeOverride || adminUserOverride ? [`# Runtime override: model=${modelOverride || '<default>'}, runtime=${runtimeOverride || '<default>'}, admin=${adminUserOverride || '<default>'}.`] : []),
  ''
].join('\n');
const yaml = header + resources.map(resource => JSON.stringify(resource, null, 2)).join('\n---\n') + '\n';
await writeFile(outPath, yaml);
console.log(`PASS rendered ${resources.length} AgentTeams resources to ${outPath}`);
