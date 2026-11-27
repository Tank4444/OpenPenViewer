import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { figToPen } from '../src/pen/figma/figConverter';
import { layoutDocument } from '../src/pen/layout';
import type { PenNode } from '../src/pen/types';

const REAL_FIG = path.resolve(process.cwd(), 'examples/Пойди_ найди (Copy).fig');

function walkNodes(nodes: PenNode[], visit: (n: PenNode) => void): void {
  for (const n of nodes) {
    visit(n);
    const children = (n as { children?: PenNode[] }).children;
    if (Array.isArray(children)) walkNodes(children, visit);
  }
}

describe('Real Figma (.fig) import — Пойди_ найди (Copy).fig', () => {
  it('imports all visible pages, embedded images, expanded INSTANCE/SYMBOL trees, and vector paths', () => {
    if (!fs.existsSync(REAL_FIG)) return;

    const bytes = fs.readFileSync(REAL_FIG);
    const doc = figToPen(bytes);

    // 1. Multi-page support
    expect(doc.pages).toBeDefined();
    const pages = doc.pages ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(7);
    const pageNames = pages.map((p) => p.name);
    expect(pageNames).not.toContain('Internal Only Canvas');
    expect(pageNames.some((n) => n.includes('Обложка'))).toBe(true);
    expect(pageNames.some((n) => n.includes('Дизайн'))).toBe(true);
    expect(pageNames.some((n) => n.includes('Прототип'))).toBe(true);
    expect(doc.activePageId).toBeTruthy();

    // 2. Count nodes, image fills, expanded instances, paths, and check finite geometry across all pages
    let totalNodes = 0;
    let imageFillCount = 0;
    let pathCount = 0;
    let nonFiniteCount = 0;

    for (const page of pages) {
      walkNodes(page.children, (n) => {
        totalNodes++;
        if (n.type === 'path') pathCount++;
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) nonFiniteCount++;

        const fill = (n as { fill?: unknown }).fill;
        const fills = Array.isArray(fill) ? fill : fill ? [fill] : [];
        for (const f of fills) {
          if (f && typeof f === 'object' && (f as { type?: string }).type === 'image') {
            const url = (f as { url?: string }).url ?? '';
            if (url.startsWith('blob:') || url.startsWith('data:image/')) {
              imageFillCount++;
            }
          }
        }
      });
    }

    expect(totalNodes).toBeGreaterThan(20000);
    expect(imageFillCount).toBeGreaterThan(50);
    expect(pathCount).toBeGreaterThan(5000);
    expect(nonFiniteCount).toBe(0);

    // 3. Verify Figma v106 fidelity on "Дизайн 11.11.2026" after layoutDocument:
    //    - frameMaskDisabled -> clip: true
    //    - wrapped chips (1193:1087) keep row-2 y ≈ 41
    //    - rotated instance (1133:14415) has non-zero rotation
    const designPage = pages.find((p) => p.id === '1:27');
    expect(designPage).toBeDefined();
    if (designPage) {
      const laidOut = layoutDocument({ version: '1.0', children: designPage.children });
      let tiktokChip: PenNode | undefined;
      let rotatedInst: PenNode | undefined;
      let clippedFrames = 0;
      walkNodes(laidOut.children, (n) => {
        if (n.id === '1193:1087') tiktokChip = n;
        if (n.id === '1133:14415') rotatedInst = n;
        if (n.type === 'frame' && (n as { clip?: boolean }).clip === true) clippedFrames++;
      });
      expect(clippedFrames).toBeGreaterThan(100);
      expect(tiktokChip).toBeDefined();
      expect(tiktokChip?.x).toBeCloseTo(0, 0);
      expect(tiktokChip?.y).toBeCloseTo(41, 0);
      expect(Math.abs((rotatedInst as { rotation?: number } | undefined)?.rotation ?? 0)).toBeGreaterThan(45);
    }
  });
});

