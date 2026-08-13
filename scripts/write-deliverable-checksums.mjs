import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../deliverables/', import.meta.url);
const names = [
  'DevOrbit_初赛方案.pdf',
  'DevOrbit_初赛方案.pptx',
  'DevOrbit_初赛可执行代码包.zip',
  'DevOrbit_演示视频.mp4',
  'DevOrbit_演示视频封面.png',
  'DevOrbit_初赛讲解视频_自动语音版.mp4',
  'DevOrbit_Agent-Identity清单.pdf',
  'DevOrbit_Skill清单.pdf',
  'DevOrbit_工具与云产品清单.pdf',
  'DevOrbit_威胁模型.pdf',
  'DevOrbit_证据索引.pdf',
  'DevOrbit_对照与消融评测.pdf',
  'DevOrbit_对抗安全评测.pdf',
  'DevOrbit_公开基准复现试点.pdf'
];
const lines = [];
for (const name of names) {
  const data = await readFile(new URL(name, dir));
  lines.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await writeFile(new URL('交付物_SHA256.txt', dir), lines.join('\n') + '\n');
console.log('PASS wrote deliverable SHA-256 manifest');
