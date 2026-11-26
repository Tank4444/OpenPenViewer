import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parsePenText } from '../src/pen/parser';
import { resolveRefs } from '../src/pen/refs';
import { substituteVariables } from '../src/pen/variables';
import { layoutDocument } from '../src/pen/layout';
import { ensureLucideLoaded } from '../src/pen/renderer/lucideIcons';
import { penToFig, figToPen } from '../src/pen/figma/figConverter';
import { parseFigFile } from '../src/pen/figma/figKiwi';
import type { PenNode } from '../src/pen/types';

const EXAMPLE_PEN = path.resolve(process.cwd(), 'examples/E-Commerce Store (DummyJSON).pen');
const EXAMPLE_FIG = path.resolve(process.cwd(), 'examples/exported.fig');

interface FlatNode {
  path: string;
  screen: string;
  id: string;
  name: string;
  type: string;
  wx: number;
  wy: number;
  w: number;
  h: number;
  node: PenNode;
}

function flattenWorld(
  nodes: PenNode[],
  ox = 0,
  oy = 0,
  screen = '',
  prefix = '',
  out: FlatNode[] = [],
  skipSyntheticIconChild = false,
): FlatNode[] {
  nodes.forEach((n, idx) => {
    const nx = ox + (typeof n.x === 'number' ? n.x : 0);
    const ny = oy + (typeof n.y === 'number' ? n.y : 0);
    const w = typeof (n as { width?: unknown }).width === 'number' ? (n as { width: number }).width : 0;
    const h = typeof (n as { height?: unknown }).height === 'number' ? (n as { height: number }).height : 0;
    const scr = screen || n.name || n.id;
    const p = prefix ? `${prefix}/${idx}:${n.name || n.id}` : `${idx}:${n.name || n.id}`;
    out.push({ path: p, screen: scr, id: n.id, name: n.name || n.id, type: n.type, wx: nx, wy: ny, w, h, node: n });
    const children = (n as { children?: PenNode[] }).children;
    const isSyntheticIconWrapper =
      skipSyntheticIconChild &&
      n.type === 'frame' &&
      Array.isArray(children) &&
      children.length === 1 &&
      children[0].type === 'path' &&
      typeof children[0].name === 'string' &&
      children[0].name.endsWith(' Vector');
    if (Array.isArray(children) && !isSyntheticIconWrapper) {
      flattenWorld(children, nx, ny, scr, p, out, skipSyntheticIconChild);
    }
  });
  return out;
}

describe('Example E-Commerce .pen <-> .fig diagnostics', () => {
  it('diagnoses Scenario 1 (Open .pen), Scenario 2 (Export .fig), and Scenario 3 (Open .fig)', async () => {
    expect(fs.existsSync(EXAMPLE_PEN)).toBe(true);
    await ensureLucideLoaded();

    // --- SCENARIO 1: Open .pen ---
    const rawText = fs.readFileSync(EXAMPLE_PEN, 'utf-8');
    const parsed = parsePenText(rawText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const refsResolved = resolveRefs(parsed.doc);
    const substituted = substituteVariables(refsResolved);
    const docBefore = layoutDocument(substituted);

    const flatBefore = flattenWorld(docBefore.children);
    const unsupportedBefore = flatBefore.filter((f) => f.type === 'unsupported');
    const remainingRefs = flatBefore.filter((f) => f.type === 'ref');
    const nonFiniteGeom = flatBefore.filter(
      (f) => !Number.isFinite(f.wx) || !Number.isFinite(f.wy) || !Number.isFinite(f.w) || !Number.isFinite(f.h),
    );
    const unresolvedVars: string[] = [];
    for (const f of flatBefore) {
      const s = JSON.stringify({
        fill: (f.node as { fill?: unknown }).fill,
        stroke: (f.node as { stroke?: unknown }).stroke,
      });
      if (s && /"\$[a-zA-Z0-9_-]+/.test(s)) {
        unresolvedVars.push(`${f.screen} -> ${f.name}: ${s}`);
      }
    }

    const iconsBefore = flatBefore.filter((f) => f.type === 'icon_font');

    // --- SCENARIO 2: Export .pen -> .fig ---
    const figBytes = penToFig(docBefore, 'E-Commerce Store (DummyJSON)');
    const figParsed = parseFigFile(figBytes);
    const changes = figParsed.message.nodeChanges ?? [];
    const blobs = (figParsed.message.blobs as unknown[] | undefined) ?? [];

    const fallbackTextIcons = changes.filter(
      (c) =>
        c.type === 'TEXT' &&
        typeof c.fontName?.family === 'string' &&
        c.fontName.family.toLowerCase().includes('material'),
    );

    // --- SCENARIO 3: Open .fig ---
    const importedRaw = figToPen(figBytes);
    const importedParsed = parsePenText(JSON.stringify(importedRaw));
    expect(importedParsed.ok).toBe(true);
    if (!importedParsed.ok) return;
    const docAfter = layoutDocument(substituteVariables(resolveRefs(importedParsed.doc)));
    const flatAfter = flattenWorld(docAfter.children, 0, 0, '', '', [], true);

    // Compare geometry & properties node-by-node
    const geomDiffs: Array<{ screen: string; name: string; typeBefore: string; typeAfter: string; dx: number; dy: number; dw: number; dh: number }> = [];
    const textDiffs: Array<{ screen: string; name: string; issue: string }> = [];
    const count = Math.min(flatBefore.length, flatAfter.length);

    for (let i = 0; i < count; i++) {
      const a = flatBefore[i];
      const b = flatAfter[i];
      const dx = Math.round((b.wx - a.wx) * 10) / 10;
      const dy = Math.round((b.wy - a.wy) * 10) / 10;
      const dw = Math.round((b.w - a.w) * 10) / 10;
      const dh = Math.round((b.h - a.h) * 10) / 10;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2 || Math.abs(dw) > 2 || Math.abs(dh) > 2) {
        geomDiffs.push({
          screen: a.screen,
          name: a.name,
          typeBefore: a.type,
          typeAfter: b.type,
          dx,
          dy,
          dw,
          dh,
        });
      }
      if (a.type === 'text' && b.type === 'text') {
        const ta = a.node as { content?: string; fontSize?: number; fontWeight?: unknown; textAlign?: string };
        const tb = b.node as { content?: string; fontSize?: number; fontWeight?: unknown; textAlign?: string };
        if (ta.content !== tb.content) textDiffs.push({ screen: a.screen, name: a.name, issue: `content mismatch` });
        if (String(ta.fontWeight ?? '') !== String(tb.fontWeight ?? '')) {
          textDiffs.push({
            screen: a.screen,
            name: a.name,
            issue: `fontWeight ${String(ta.fontWeight)} -> ${String(tb.fontWeight)}`,
          });
        }
      }
    }

    // Also test existing examples/exported.fig if present
    if (fs.existsSync(EXAMPLE_FIG)) {
      const existingBytes = fs.readFileSync(EXAMPLE_FIG);
      const existingDoc = figToPen(existingBytes);
      expect(existingDoc.children.length).toBe(17);
    }

    // Scenario 1: Open .pen
    expect(docBefore.children.length).toBe(17);
    expect(unsupportedBefore.length).toBe(0);
    expect(remainingRefs.length).toBe(0);
    expect(nonFiniteGeom.length).toBe(0);
    expect(unresolvedVars.length).toBe(0);

    // Scenario 2: Export .pen -> .fig
    expect(figBytes.length).toBeGreaterThan(1000);
    expect(blobs.length).toBe(iconsBefore.length);
    expect(fallbackTextIcons.length).toBe(0);

    // Scenario 3: Open .fig (round-trip fidelity)
    expect(docAfter.children.length).toBe(17);
    expect(flatAfter.length).toBe(flatBefore.length);
    expect(geomDiffs).toEqual([]);
    const nonNormalWeightTextDiffs = textDiffs.filter((d) => d.issue !== 'fontWeight normal -> undefined');
    expect(nonNormalWeightTextDiffs).toEqual([]);
  });
});

