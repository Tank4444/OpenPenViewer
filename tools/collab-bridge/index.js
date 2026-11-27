#!/usr/bin/env node
/**
 * Pencil Collab Bridge — WebSocket + HTTP REST + MCP サーバー
 *
 * 3つのインターフェースを同時に提供:
 *   1. WebSocket (ws://localhost:4567)  — ブラウザとリアルタイム同期
 *   2. HTTP REST  (http://localhost:4567) — CLI / curl / 外部ツール連携
 *   3. MCP (stdin/stdout)               — Claude Code 連携
 *
 * [BETA] この機能は実験的です。
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { createInterface } from 'readline';
import { listSkills, readSkill } from './skillsLoader.js';

// Never crash the MCP stdio process on unexpected async/socket errors
process.on('uncaughtException', (err) => {
  process.stderr.write(`[collab-bridge] uncaughtException: ${err?.stack || err}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[collab-bridge] unhandledRejection: ${reason}\n`);
});

const VALID_NODE_TYPES = new Set([
  'frame',
  'rectangle',
  'ellipse',
  'line',
  'polygon',
  'path',
  'text',
  'group',
  'icon_font',
  'image',
  'note',
  'ref',
  'connection',
]);

const VALID_VAR_TYPES = new Set(['color', 'number', 'boolean', 'string']);

/** Validate and normalize a PenNode tree before inserting/updating so malformed AI output never crashes the editor. */
function validateAndNormalizeNode(raw, depth = 0) {
  if (depth > 30) throw new Error('Node nesting too deep (max 30 levels)');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Node must be a plain object');
  }
  if (typeof raw.type !== 'string' || !VALID_NODE_TYPES.has(raw.type)) {
    throw new Error(`Unsupported node type "${String(raw.type)}". Allowed: ${[...VALID_NODE_TYPES].join(', ')}`);
  }
  const copy = { ...raw };
  copy.id = typeof copy.id === 'string' && copy.id.trim()
    ? copy.id.trim()
    : `node_${Math.random().toString(36).slice(2, 9)}`;

  for (const numKey of ['x', 'y', 'fontSize', 'opacity', 'rotation', 'gap', 'cornerRadius']) {
    if (numKey in copy && typeof copy[numKey] === 'number' && !Number.isFinite(copy[numKey])) {
      delete copy[numKey];
    }
  }
  for (const sizeKey of ['width', 'height']) {
    if (sizeKey in copy && typeof copy[sizeKey] === 'number' && !Number.isFinite(copy[sizeKey])) {
      delete copy[sizeKey];
    }
  }
  if ('children' in copy) {
    if (!Array.isArray(copy.children)) {
      throw new Error(`Node "${copy.id}" has non-array children`);
    }
    copy.children = copy.children.map((c) => validateAndNormalizeNode(c, depth + 1));
  }
  return copy;
}

const PORT = parseInt(process.env.PORT ?? '4567', 10);

// ── Yjs Document ──
const ydoc = new Y.Doc();
const ymap = ydoc.getMap('pen-document');

// ── HTTP Server ──
const httpServer = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /status
    if (req.method === 'GET' && path === '/status') {
      return json(res, {
        wsPort: PORT,
        connectedClients: wsClients.size,
        hasDocument: ymap.size > 0,
        nodeCount: getPenDoc().children.length,
      });
    }

    // GET /document
    if (req.method === 'GET' && path === '/document') {
      return json(res, getPenDoc());
    }

    // GET /frames
    if (req.method === 'GET' && path === '/frames') {
      return json(res, listFrames(getPenDoc().children));
    }

    // GET /node/:id
    if (req.method === 'GET' && path.startsWith('/node/')) {
      const id = path.slice(6);
      const node = findNode(getPenDoc().children, id);
      if (!node) return json(res, { error: `Node not found: ${id}` }, 404);
      return json(res, node);
    }

    // PUT /node/:id  — body: { ...patch }
    if (req.method === 'PUT' && path.startsWith('/node/')) {
      const id = path.slice(6);
      const body = await readBody(req);
      const patch = JSON.parse(body);
      const doc = getPenDoc();
      const updated = updateNode(doc.children, id, patch);
      ydoc.transact(() => { ymap.set('children', JSON.stringify(updated)); });
      broadcastDoc(getPenDoc());
      return json(res, { ok: true, id });
    }

    // POST /document — body: full PenDocument
    if (req.method === 'POST' && path === '/document') {
      const body = await readBody(req);
      const doc = JSON.parse(body);
      ydoc.transact(() => {
        ymap.set('version', doc.version ?? '1.0');
        ymap.set('children', JSON.stringify(doc.children));
        if (doc.variables) ymap.set('variables', JSON.stringify(doc.variables));
      });
      broadcastDoc(getPenDoc());
      return json(res, { ok: true });
    }

    // GET /export-design-doc?project=Name&locale=ja
    if (req.method === 'GET' && path === '/export-design-doc') {
      const doc = getPenDoc();
      const project = url.searchParams.get('project') ?? 'Design Document';
      const locale = url.searchParams.get('locale') ?? 'ja';
      const md = generateDesignDoc(doc, project, locale);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(md);
      return;
    }

    // GET /check-ui-states
    if (req.method === 'GET' && path === '/check-ui-states') {
      const doc = getPenDoc();
      const results = analyzeUIStates(doc);
      return json(res, { report: formatReport(results), data: results });
    }

    // GET /skills
    if (req.method === 'GET' && path === '/skills') {
      return json(res, listSkills());
    }

    // GET /skills/:name
    if (req.method === 'GET' && path.startsWith('/skills/')) {
      const skillName = decodeURIComponent(path.slice(8));
      const skill = readSkill(skillName);
      if (!skill) return json(res, { error: `Skill not found: ${skillName}` }, 404);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(skill.content);
      return;
    }

    // GET /screenshot?nodeId=...&scale=2
    if (req.method === 'GET' && path === '/screenshot') {
      const nodeId = url.searchParams.get('nodeId') ?? undefined;
      const scale = Number(url.searchParams.get('scale') ?? '2');
      const shot = await requestScreenshot(nodeId, Number.isFinite(scale) ? scale : 2);
      const base64 = shot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(base64, 'base64');
      res.writeHead(200, {
        'Content-Type': shot.mimeType || 'image/png',
        'Content-Length': String(buf.length),
      });
      res.end(buf);
      return;
    }

    // 404
    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: String(e) }, 500);
  }
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── WebSocket Server (同じ HTTP サーバー上) ──
const wss = new WebSocketServer({ server: httpServer });
const wsClients = new Set();
const pendingScreenshots = new Map();
let nextShotId = 1;

function requestScreenshot(nodeId, scale = 2) {
  const client = Array.from(wsClients).find((ws) => ws.readyState === 1);
  if (!client) {
    return Promise.reject(new Error('No OpenPenViewer client connected to MCP Bridge'));
  }
  const requestId = `shot-${nextShotId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingScreenshots.delete(requestId);
      reject(new Error('Screenshot timed out (10s)'));
    }, 10000);
    pendingScreenshots.set(requestId, { resolve, reject, timer });
    client.send(JSON.stringify({ type: 'screenshot-request', requestId, nodeId, scale }));
  });
}

function broadcast(data, sender) {
  for (const ws of wsClients) {
    if (ws !== sender && ws.readyState === 1) ws.send(data);
  }
}

function broadcastDoc(doc) {
  const msg = JSON.stringify({ type: 'pen-doc', doc });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  wsClients.add(ws);
  log(`WebSocket client connected (${wsClients.size} total)`);

  // Send current state
  const doc = getPenDoc();
  if (doc.children.length > 0) {
    ws.send(JSON.stringify({ type: 'pen-doc', doc }));
  }

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'pen-doc' && parsed.doc) {
        ydoc.transact(() => {
          ymap.set('version', parsed.doc.version ?? '1.0');
          ymap.set('children', JSON.stringify(parsed.doc.children));
          if (parsed.doc.variables) ymap.set('variables', JSON.stringify(parsed.doc.variables));
        });
        broadcast(msg, ws);
      } else if (parsed.type === 'screenshot-response' && parsed.requestId) {
        const pending = pendingScreenshots.get(parsed.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingScreenshots.delete(parsed.requestId);
          if (parsed.error) pending.reject(new Error(parsed.error));
          else pending.resolve(parsed);
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('error', (err) => {
    log(`WebSocket client error: ${err.message}`);
    wsClients.delete(ws);
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    log(`WebSocket client disconnected (${wsClients.size} total)`);
  });
});

// ── Document helpers ──
function getPenDoc() {
  const version = ymap.get('version') ?? '1.0';
  const childrenStr = ymap.get('children');
  const variablesStr = ymap.get('variables');
  if (!childrenStr) return { version, children: [] };
  try {
    return {
      version,
      children: JSON.parse(childrenStr),
      variables: variablesStr ? JSON.parse(variablesStr) : undefined,
    };
  } catch { return { version, children: [] }; }
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}

function updateNode(nodes, id, patch) {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.children) return { ...n, children: updateNode(n.children, id, patch) };
    return n;
  });
}

function insertNode(nodes, parentId, newNode, index) {
  if (!parentId) {
    const copy = [...nodes];
    if (typeof index === 'number' && index >= 0 && index <= copy.length) {
      copy.splice(index, 0, newNode);
    } else {
      copy.push(newNode);
    }
    return { updated: copy, inserted: true };
  }
  let inserted = false;
  const updated = nodes.map((n) => {
    if (n.id === parentId) {
      inserted = true;
      const kids = Array.isArray(n.children) ? [...n.children] : [];
      if (typeof index === 'number' && index >= 0 && index <= kids.length) {
        kids.splice(index, 0, newNode);
      } else {
        kids.push(newNode);
      }
      return { ...n, children: kids };
    }
    if (Array.isArray(n.children)) {
      const res = insertNode(n.children, parentId, newNode, index);
      if (res.inserted) {
        inserted = true;
        return { ...n, children: res.updated };
      }
    }
    return n;
  });
  return { updated, inserted };
}

function removeNode(nodes, id) {
  let removed = false;
  const out = [];
  for (const n of nodes) {
    if (n.id === id) {
      removed = true;
      continue;
    }
    if (Array.isArray(n.children)) {
      const res = removeNode(n.children, id);
      if (res.removed) {
        removed = true;
        out.push({ ...n, children: res.updated });
        continue;
      }
    }
    out.push(n);
  }
  return { updated: out, removed };
}

function listFrames(nodes, result = []) {
  for (const n of nodes) {
    if (n.type === 'frame' || n.type === 'group') {
      result.push({ id: n.id, name: n.name ?? n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height });
    }
    if (n.children) listFrames(n.children, result);
  }
  return result;
}

// ── Five UI States Analyzer ──
const STATE_PATTERNS = [
  { state: 'empty', patterns: [/empty/i, /no.?data/i, /no.?result/i, /no.?item/i, /zero.?state/i, /blank/i, /空/i, /データなし/i, /結果なし/i, /未登録/i, /まだ/i] },
  { state: 'loading', patterns: [/loading/i, /spinner/i, /skeleton/i, /shimmer/i, /progress/i, /読み込み/i, /ロード/i] },
  { state: 'error', patterns: [/error/i, /fail/i, /404/i, /500/i, /offline/i, /エラー/i, /失敗/i, /not.?found/i] },
  { state: 'partial', patterns: [/partial/i, /incomplete/i, /limited/i, /部分/i, /一部/i, /制限/i] },
];

function inferState(name) {
  for (const { state, patterns } of STATE_PATTERNS) {
    if (patterns.some(p => p.test(name))) return state;
  }
  return 'ideal';
}

function extractScreenName(name) {
  let clean = name.replace(/^WF:\s*/i, '').replace(/^Screen:\s*/i, '');
  for (const { patterns } of STATE_PATTERNS) {
    for (const p of patterns) {
      clean = clean.replace(new RegExp(`[\\s\\-_/|]+${p.source}$`, 'i'), '');
    }
  }
  return clean.trim() || name;
}

function analyzeUIStates(doc) {
  const allStates = ['ideal', 'empty', 'loading', 'error', 'partial'];
  const frames = doc.children
    .filter(n => n.type === 'frame' && typeof n.width === 'number' && n.width >= 100 && typeof n.height === 'number' && n.height >= 100)
    .map(n => ({ id: n.id, name: n.name ?? n.id, x: n.x ?? 0, y: n.y ?? 0, width: n.width, height: n.height, inferredState: inferState(n.name ?? '') }));

  const groups = new Map();
  for (const f of frames) {
    const screen = extractScreenName(f.name);
    if (!groups.has(screen)) groups.set(screen, []);
    groups.get(screen).push(f);
  }

  const results = [];
  for (const [screenName, screenFrames] of groups) {
    const detected = [...new Set(screenFrames.map(f => f.inferredState))];
    const missing = allStates.filter(s => !detected.includes(s));
    const coverage = Math.round((detected.length / allStates.length) * 100);
    results.push({ screenName, frames: screenFrames, detectedStates: detected, missingStates: missing, coverage });
  }
  results.sort((a, b) => a.coverage - b.coverage);
  return results;
}

function formatReport(results) {
  const lines = ['# Five UI States Analysis Report', ''];
  const total = results.length;
  const full = results.filter(r => r.coverage === 100).length;
  lines.push(`> ${full} of ${total} screens have full coverage`, '');

  const stateLabels = { ideal: '✅ Ideal', empty: '📭 Empty', loading: '⏳ Loading', error: '❌ Error', partial: '🔶 Partial' };
  for (const g of results) {
    const icon = g.coverage === 100 ? '✅' : g.coverage >= 60 ? '⚠️' : '❌';
    lines.push(`## ${icon} ${g.screenName} (${g.coverage}%)`);
    lines.push(`**Detected**: ${g.detectedStates.map(s => stateLabels[s]).join(', ')}`);
    if (g.missingStates.length > 0) {
      lines.push(`**Missing**: ${g.missingStates.map(s => stateLabels[s]).join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function generateDesignDoc(doc, projectName, locale = 'ja') {
  const results = analyzeUIStates(doc);
  const allStates = ['ideal', 'empty', 'loading', 'error', 'partial'];
  const stateLabels = { ideal: '✅ Ideal', empty: '📭 Empty', loading: '⏳ Loading', error: '❌ Error', partial: '🔶 Partial' };
  const lines = [];

  lines.push(`# 📐 ${projectName}`);
  lines.push(`> ${locale === 'ja' ? '自動生成:' : 'Auto-generated:'} ${new Date().toISOString().split('T')[0]}`);
  lines.push('');

  // Summary table
  lines.push(locale === 'ja' ? '## 📊 画面サマリー' : '## 📊 Screen Summary');
  lines.push('');
  lines.push(`| ${locale === 'ja' ? '画面名' : 'Screen'} | States | ${locale === 'ja' ? 'カバー率' : 'Coverage'} | ${locale === 'ja' ? '不足' : 'Missing'} |`);
  lines.push('|---|---|---|---|');
  for (const g of results) {
    const icons = allStates.map(s => g.detectedStates.includes(s) ? stateLabels[s].split(' ')[0] : '⬜').join('');
    const missing = g.missingStates.length > 0 ? g.missingStates.map(s => stateLabels[s]).join(', ') : '—';
    lines.push(`| ${g.screenName} | ${icons} | ${g.coverage}% | ${missing} |`);
  }
  lines.push('');

  // Stats
  const total = results.length;
  const full = results.filter(r => r.coverage === 100).length;
  const avg = total > 0 ? Math.round(results.reduce((s, r) => s + r.coverage, 0) / total) : 0;
  lines.push(locale === 'ja' ? '### 統計' : '### Statistics');
  lines.push(`- ${locale === 'ja' ? '全画面数' : 'Total'}: ${total}`);
  lines.push(`- ${locale === 'ja' ? '完全カバー' : 'Full coverage'}: ${full}`);
  lines.push(`- ${locale === 'ja' ? '平均カバー率' : 'Average'}: ${avg}%`);
  lines.push('', '---', '');

  // Each screen
  const frames = doc.children.filter(n => n.type === 'frame' && typeof n.width === 'number' && n.width >= 100);
  for (const f of frames) {
    const name = f.name ?? f.id;
    lines.push(`# 📱 ${name}`);
    lines.push(`- ID: \`${f.id}\``);
    lines.push(`- ${locale === 'ja' ? 'サイズ' : 'Size'}: ${f.width} × ${f.height}`);
    lines.push('');

    // Five UI States for this frame
    const group = results.find(g => g.frames.some(gf => gf.id === f.id));
    lines.push('## Five UI States');
    lines.push(`| State | ${locale === 'ja' ? '状態' : 'Status'} |`);
    lines.push('|---|---|');
    for (const s of allStates) {
      const detected = group ? group.detectedStates.includes(s) : s === 'ideal';
      lines.push(`| ${stateLabels[s]} | ${detected ? '✅' : '⚠️'} |`);
    }
    lines.push('');

    // Component tree (depth 2)
    lines.push(locale === 'ja' ? '## コンポーネント構成' : '## Components');
    if (f.children) {
      for (const c of f.children) {
        const cn = c.name ?? c.id;
        lines.push(`- **${cn}** (${c.type})`);
        if (c.children) {
          for (const cc of c.children) {
            lines.push(`  - ${cc.name ?? cc.id} (${cc.type})`);
          }
        }
      }
    }
    lines.push('', '---', '');
  }

  // Variables
  if (doc.variables) {
    lines.push(locale === 'ja' ? '# 🔧 デザイントークン' : '# 🔧 Design Tokens');
    lines.push('```json');
    lines.push(JSON.stringify(doc.variables, null, 2));
    lines.push('```');
  }

  return lines.join('\n');
}

function getStateDescription(state, screenName) {
  switch (state) {
    case 'empty': return `${screenName} にデータがまだ存在しない場合の表示。初回利用時やフィルタ結果が0件の場合。アクションへの導線を提示する。`;
    case 'loading': return `${screenName} のデータを読み込み中の表示。スケルトン UI やスピナーを使い、進捗を示す。`;
    case 'error': return `${screenName} でエラーが発生した場合の表示。原因の説明とリトライ操作を提示する。`;
    case 'partial': return `${screenName} のデータが一部のみ表示されている状態。ネットワーク不安定時やページネーション途中。`;
    case 'ideal': return `${screenName} の正常表示。データが正しく読み込まれた理想的な状態。`;
    default: return '';
  }
}

// ── MCP Server (stdin/stdout JSON-RPC) ──
const rl = createInterface({ input: process.stdin });

const TOOLS = [
  { name: 'list_skills', description: 'List all built-in OpenPenViewer design & editing skills with descriptions and URIs. Call this first to learn .pen format, UI design guidelines, visual QA, Figma export rules, and code handoff.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_skill', description: 'Read the full Markdown instructions of a specific OpenPenViewer skill by name (from list_skills).', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Skill name, e.g. "pen-format-and-layout", "ui-design-system", "visual-qa-workflow", "figma-export-ready", "design-to-code-handoff"' } }, required: ['name'] } },
  { name: 'list_frames', description: 'List all frames in the document', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_node', description: 'Read a node by ID', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'update_node', description: 'Update node properties', inputSchema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id', 'patch'] } },
  { name: 'add_node', description: 'Add a new PenNode (screen, frame, text, rectangle, icon_font, etc.) at root or inside a parent frame.', inputSchema: { type: 'object', properties: { parentId: { type: 'string', description: 'Optional parent frame/group ID. Omit to append at top-level.' }, node: { type: 'object', description: 'Valid PenNode object (must include type; id is auto-generated if omitted).' }, index: { type: 'number', description: 'Optional insertion index inside children array.' } }, required: ['node'] } },
  { name: 'delete_node', description: 'Delete a node by ID from the open document.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the node to delete' } }, required: ['id'] } },
  { name: 'set_variable', description: 'Create or update a design token variable in doc.variables (referenced via "$name" in fills/strokes).', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Variable name without leading $' }, type: { type: 'string', enum: ['color', 'number', 'boolean', 'string'], description: 'Variable type' }, value: { description: 'Variable value (hex color, number, boolean, or string)' } }, required: ['name', 'type', 'value'] } },
  { name: 'get_document', description: 'Get full PenDocument', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_status', description: 'Get bridge status', inputSchema: { type: 'object', properties: {} } },
  { name: 'check_ui_states', description: 'Analyze Five UI States coverage for all screens. Returns a report showing which states (Ideal/Empty/Loading/Error/Partial) are defined and which are missing.', inputSchema: { type: 'object', properties: {} } },
  { name: 'suggest_missing_states', description: 'Get suggestions for missing UI states with frame templates that can be added to the document.', inputSchema: { type: 'object', properties: { screenName: { type: 'string', description: 'Screen name to get suggestions for (from check_ui_states result)' } }, required: ['screenName'] } },
  { name: 'export_design_doc', description: 'Export a design document in Markdown format with Five UI States analysis, component structure, and design tokens.', inputSchema: { type: 'object', properties: { projectName: { type: 'string', description: 'Project name for the document title' }, locale: { type: 'string', enum: ['en', 'ja'], description: 'Language (default: ja)' } } } },
  { name: 'get_screenshot', description: 'Capture a PNG screenshot of the current open design canvas or a specific frame/node by ID.', inputSchema: { type: 'object', properties: { nodeId: { type: 'string', description: 'Optional frame or node ID to crop to. If omitted, captures the current viewport.' }, scale: { type: 'number', description: 'Pixel scale factor (1-4, default: 2)' } } } },
];

const SERVER_INSTRUCTIONS =
  'OpenPenViewer MCP server. Before creating or editing .pen designs, call list_skills and read the relevant skill with get_skill (e.g. pen-format-and-layout, ui-design-system, visual-qa-workflow, figma-export-ready, design-to-code-handoff). Always visually verify changes with get_screenshot.';

function handleMcpRequest(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'openpenviewer-mcp', version: '0.3.0' },
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    });
  }
  if (method === 'tools/list') return respond(id, { tools: TOOLS });
  if (method === 'resources/list') {
    const resources = listSkills().map((s) => ({
      uri: s.uri,
      name: s.title,
      description: s.description,
      mimeType: 'text/markdown',
    }));
    return respond(id, { resources });
  }
  if (method === 'resources/read') {
    const uri = params?.uri ?? '';
    const skill = readSkill(uri);
    if (!skill) return respondError(id, -32602, `Skill resource not found: ${uri}`);
    return respond(id, {
      contents: [
        {
          uri: skill.meta.uri,
          mimeType: 'text/markdown',
          text: skill.content,
        },
      ],
    });
  }
  if (method === 'notifications/initialized') return;

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const doc = getPenDoc();
    switch (name) {
      case 'list_skills':
        return respond(id, { content: [{ type: 'text', text: JSON.stringify(listSkills(), null, 2) }] });
      case 'get_skill': {
        const skill = readSkill(args.name);
        if (!skill) {
          const available = listSkills().map((s) => s.name).join(', ');
          return respond(id, {
            content: [{ type: 'text', text: `Skill not found: "${args.name}". Available skills: ${available}` }],
            isError: true,
          });
        }
        return respond(id, { content: [{ type: 'text', text: skill.content }] });
      }
      case 'list_frames': return respond(id, { content: [{ type: 'text', text: JSON.stringify(listFrames(doc.children), null, 2) }] });
      case 'read_node': {
        const node = findNode(doc.children, args.id);
        return respond(id, { content: [{ type: 'text', text: node ? JSON.stringify(node, null, 2) : `Not found: ${args.id}` }], ...(node ? {} : { isError: true }) });
      }
      case 'update_node': {
        if (!args.id || typeof args.id !== 'string') {
          return respond(id, { content: [{ type: 'text', text: 'Invalid argument: "id" must be a non-empty string.' }], isError: true });
        }
        if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) {
          return respond(id, { content: [{ type: 'text', text: 'Invalid argument: "patch" must be a plain object.' }], isError: true });
        }
        if (!findNode(doc.children, args.id)) {
          return respond(id, { content: [{ type: 'text', text: `Node not found: ${args.id}` }], isError: true });
        }
        const updated = updateNode(doc.children, args.id, args.patch);
        ydoc.transact(() => { ymap.set('children', JSON.stringify(updated)); });
        broadcastDoc(getPenDoc());
        return respond(id, { content: [{ type: 'text', text: `Updated: ${args.id}` }] });
      }
      case 'add_node': {
        let nodeToInsert;
        try {
          nodeToInsert = validateAndNormalizeNode(args.node);
        } catch (err) {
          return respond(id, { content: [{ type: 'text', text: `Invalid node: ${err instanceof Error ? err.message : String(err)}` }], isError: true });
        }
        const res = insertNode(doc.children, args.parentId, nodeToInsert, args.index);
        if (!res.inserted) {
          return respond(id, { content: [{ type: 'text', text: `Parent node not found: ${args.parentId}` }], isError: true });
        }
        ydoc.transact(() => { ymap.set('children', JSON.stringify(res.updated)); });
        broadcastDoc(getPenDoc());
        return respond(id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: nodeToInsert.id, parentId: args.parentId ?? null }) }] });
      }
      case 'delete_node': {
        if (!args.id || typeof args.id !== 'string') {
          return respond(id, { content: [{ type: 'text', text: 'Invalid argument: "id" must be a non-empty string.' }], isError: true });
        }
        const res = removeNode(doc.children, args.id);
        if (!res.removed) {
          return respond(id, { content: [{ type: 'text', text: `Node not found: ${args.id}` }], isError: true });
        }
        ydoc.transact(() => { ymap.set('children', JSON.stringify(res.updated)); });
        broadcastDoc(getPenDoc());
        return respond(id, { content: [{ type: 'text', text: `Deleted: ${args.id}` }] });
      }
      case 'set_variable': {
        const cleanName = String(args.name ?? '').replace(/^\$/, '').trim();
        if (!cleanName) {
          return respond(id, { content: [{ type: 'text', text: 'Variable name is required.' }], isError: true });
        }
        if (!VALID_VAR_TYPES.has(args.type)) {
          return respond(id, { content: [{ type: 'text', text: `Invalid variable type "${String(args.type)}". Allowed: color, number, boolean, string.` }], isError: true });
        }
        if (args.value === undefined || args.value === null) {
          return respond(id, { content: [{ type: 'text', text: 'Variable value is required.' }], isError: true });
        }
        const vars = { ...(doc.variables ?? {}), [cleanName]: { type: args.type, value: args.value } };
        ydoc.transact(() => { ymap.set('variables', JSON.stringify(vars)); });
        broadcastDoc(getPenDoc());
        return respond(id, { content: [{ type: 'text', text: `Set variable $${cleanName} = ${JSON.stringify(args.value)}` }] });
      }
      case 'get_document': return respond(id, { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] });
      case 'get_status': return respond(id, { content: [{ type: 'text', text: JSON.stringify({ wsPort: PORT, clients: wsClients.size, nodes: doc.children.length }, null, 2) }] });
      case 'check_ui_states': {
        const results = analyzeUIStates(doc);
        const report = formatReport(results);
        return respond(id, { content: [{ type: 'text', text: report }, { type: 'text', text: '\n---\nRaw data:\n' + JSON.stringify(results, null, 2) }] });
      }
      case 'suggest_missing_states': {
        const results = analyzeUIStates(doc);
        const screen = results.find(r => r.screenName === args.screenName);
        if (!screen) return respond(id, { content: [{ type: 'text', text: `Screen not found: ${args.screenName}. Available: ${results.map(r => r.screenName).join(', ')}` }], isError: true });
        if (screen.missingStates.length === 0) return respond(id, { content: [{ type: 'text', text: `${args.screenName}: All Five UI States are covered! 🎉` }] });
        // Generate frame templates for missing states
        const baseFrame = screen.frames[0];
        const suggestions = screen.missingStates.map((state, i) => ({
          type: 'frame',
          id: `${baseFrame.id}_${state}`,
          name: `WF: ${screen.screenName} - ${state.charAt(0).toUpperCase() + state.slice(1)}`,
          x: baseFrame.x + (baseFrame.width + 40) * (screen.frames.length + i),
          y: baseFrame.y,
          width: baseFrame.width,
          height: baseFrame.height,
          fill: '#FAF8F5',
          layout: 'vertical',
          children: [
            { type: 'text', id: `${baseFrame.id}_${state}_title`, content: `${screen.screenName} — ${state.charAt(0).toUpperCase() + state.slice(1)} State`, fontSize: 18, fontWeight: '600', fill: '#111827', x: 20, y: 20 },
            { type: 'text', id: `${baseFrame.id}_${state}_desc`, content: getStateDescription(state, screen.screenName), fontSize: 14, fill: '#6B7280', x: 20, y: 50, textGrowth: 'fixed-width', width: baseFrame.width - 40 },
          ],
        }));
        return respond(id, { content: [
          { type: 'text', text: `Missing states for "${args.screenName}": ${screen.missingStates.join(', ')}\n\nSuggested frames (use update_node or add these to the document):\n` },
          { type: 'text', text: JSON.stringify(suggestions, null, 2) },
        ] });
      }
      case 'export_design_doc': {
        const projectName = args.projectName ?? 'Design Document';
        const locale = args.locale ?? 'ja';
        const md = generateDesignDoc(doc, projectName, locale);
        return respond(id, { content: [{ type: 'text', text: md }] });
      }
      case 'get_screenshot': {
        const scale = typeof args.scale === 'number' && Number.isFinite(args.scale) ? args.scale : 2;
        requestScreenshot(args.nodeId, scale)
          .then((shot) => {
            const base64 = shot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
            respond(id, {
              content: [
                { type: 'image', data: base64, mimeType: shot.mimeType || 'image/png' },
              ],
            });
          })
          .catch((err) => {
            respond(id, {
              content: [{ type: 'text', text: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true,
            });
          });
        return;
      }
      default: return respond(id, { content: [{ type: 'text', text: `Unknown: ${name}` }], isError: true });
    }
  }
  respondError(id, -32601, `Unknown: ${method}`);
}

function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function respondError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }
function log(msg) { process.stderr.write(`[collab-bridge] ${msg}\n`); }

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    respondError(null, -32700, `Parse error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    handleMcpRequest(msg);
  } catch (err) {
    log(`MCP handler error: ${err?.stack || err}`);
    if (msg && msg.id !== undefined) {
      respondError(msg.id, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

// ── Start ──
httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    log(`Port ${PORT} is already in use by another bridge instance; MCP stdio remains active.`);
  } else {
    log(`HTTP server error: ${err?.message || err}`);
  }
});

httpServer.listen(PORT, () => {
  log(`Server listening on http://localhost:${PORT}`);
  log('');
  log('Endpoints:');
  log(`  WebSocket: ws://localhost:${PORT}`);
  log(`  REST API:  http://localhost:${PORT}`);
  log(`  MCP:       stdin/stdout`);
  log('');
  log('REST API:');
  log(`  GET  /status        — Bridge status`);
  log(`  GET  /document      — Full document`);
  log(`  GET  /frames        — Frame list`);
  log(`  GET  /node/:id      — Read node`);
  log(`  PUT  /node/:id      — Update node {patch}`);
  log(`  POST /document      — Set full document`);
  log('');
  log('Example:');
  log(`  curl http://localhost:${PORT}/frames`);
  log(`  curl -X PUT http://localhost:${PORT}/node/abc -d '{"fill":"#ff0000"}'`);
});
