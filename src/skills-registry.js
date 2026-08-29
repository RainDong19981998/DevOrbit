import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DEFAULT_ROOT = fileURLToPath(new URL('../skills', import.meta.url));

export function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

export function buildSkillsRegistry(root = DEFAULT_ROOT) {
  const entries = [];
  let dirs;
  try {
    dirs = readdirSync(root);
  } catch {
    return entries;
  }
  for (const dir of dirs.sort()) {
    const skillFile = join(root, dir, 'SKILL.md');
    try {
      if (!statSync(skillFile).isFile()) continue;
    } catch {
      continue;
    }
    const content = readFileSync(skillFile, 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter?.name) continue;
    entries.push({
      id: frontmatter.name,
      version: frontmatter.version || '0.0.0',
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      path: `skills/${dir}/SKILL.md`,
      description: frontmatter.description || ''
    });
  }
  return entries;
}

let cachedRegistry = null;

export function skillsRegistry() {
  if (!cachedRegistry) cachedRegistry = buildSkillsRegistry();
  return cachedRegistry;
}

export function resolveSkillRef(nameOrId) {
  if (!nameOrId) return null;
  const registry = skillsRegistry();
  const byId = registry.find(entry => entry.id === nameOrId);
  if (byId) return { id: byId.id, version: byId.version, digest: byId.digest };
  const kebab = nameOrId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const byKebab = registry.find(entry => entry.id === kebab);
  return byKebab ? { id: byKebab.id, version: byKebab.version, digest: byKebab.digest } : null;
}
