import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = join(__dirname, 'skills');

const SAFE_NAME_RE = /^[a-z0-9-]+$/;

/**
 * Parse lightweight YAML frontmatter delimited by `---` lines.
 */
export function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return { data: {}, body: normalized };
  }
  const header = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5).trimStart();
  const data = {};
  for (const line of header.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (!key) continue;
    if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
      data[key] = val;
    }
  }
  return { data, body };
}

/**
 * List all available skills discovered in `tools/collab-bridge/skills/*.md`.
 */
export function listSkills(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return [];
  const files = readdirSync(skillsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const out = [];
  for (const file of files) {
    const fallbackName = file.slice(0, -3);
    if (!SAFE_NAME_RE.test(fallbackName)) continue;
    const raw = readFileSync(join(skillsDir, file), 'utf-8');
    const { data } = parseFrontmatter(raw);
    const name = typeof data.name === 'string' && SAFE_NAME_RE.test(data.name) ? data.name : fallbackName;
    out.push({
      name,
      title: typeof data.title === 'string' && data.title ? data.title : name,
      description: typeof data.description === 'string' ? data.description : '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      uri: `skill://${name}`,
    });
  }
  return out;
}

/**
 * Read a single skill by its safe name (e.g. "pen-format-and-layout").
 * Returns null if not found or invalid name (path traversal protection).
 */
export function readSkill(name, skillsDir = SKILLS_DIR) {
  if (typeof name !== 'string') return null;
  const clean = name.trim().replace(/^skill:\/\//, '');
  if (!SAFE_NAME_RE.test(clean)) return null;
  const filePath = join(skillsDir, `${clean}.md`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  return {
    meta: {
      name: clean,
      title: typeof data.title === 'string' && data.title ? data.title : clean,
      description: typeof data.description === 'string' ? data.description : '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      uri: `skill://${clean}`,
    },
    content: body,
  };
}

