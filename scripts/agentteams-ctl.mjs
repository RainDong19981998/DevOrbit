import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node scripts/agentteams-ctl.mjs <agt args...> | apply -f <file>');
  process.exit(2);
}

function run(command, commandArgs, { stdinText = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}: ${stderr.slice(-1200)}`))));
    if (stdinText !== null) child.stdin.end(stdinText);
    else child.stdin.end();
  });
}

let result;
if (args[0] === 'apply' && args[1] === '-f' && args[2]) {
  const content = await readFile(args[2], 'utf8');
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  result = await run('docker', ['exec', '-i', 'agentteams-controller', 'sh', '-c', 'base64 -d > /tmp/agt-apply.json && agt apply -f /tmp/agt-apply.json'], { stdinText: encoded });
} else {
  result = await run('docker', ['exec', 'agentteams-controller', 'agt', ...args]);
}
process.stdout.write(result.stdout);
if (result.stderr.trim()) process.stderr.write(result.stderr);
