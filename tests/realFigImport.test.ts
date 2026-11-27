import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { figToPen } from '../src/pen/figma/figConverter';
import { layoutDocument } from '../src/pen/layout';
import type { PenNode } from '../src/pen/types';

const CANDIDATE_FIGS = [
  path.resolve(process.cwd(), 'examples/Пойди, найди (Copy) (Copy).fig'),
  path.resolve(process.cwd(), 'examples/Пойди_ найди (Copy).fig'),
];

const REAL_FIG = CANDIDATE_FIGS.find((p) => fs.existsSync(p));

function walkNodes(nodes: PenNode[], visit: (n: PenNode) => void): void {
  for (const n of nodes) {
    visit(n);
    const children = (n as { children?: PenNode[] }).children;
    if (Array.isArray(children)) walkNodes(children, visit);
  }
}

function findByIdOrSuffix(nodes: PenNode[], targetId: string): PenNode | undefined {
  let exact: PenNode | undefined;
  let suffixed: PenNode | undefined;
  walkNodes(nodes, (n) => {
    if (n.id === targetId) exact = n;
    else if (!suffixed && n.id.endsWith(`__${targetId}`)) suffixed = n;
  });
  return exact ?? suffixed;
}

describe('Real Figma (.fig) import — Пойди, найди (all 15 pages)', () => {
  it('accurately imports page order, overrideKey instances, custom font glyphs, rich text, masks, crops/tiles, arcs, stars, and zero-extent lines', { timeout: 30000 }, () => {
    if (!REAL_FIG) return;

    const bytes = fs.readFileSync(REAL_FIG);
    const doc = figToPen(bytes);

    // 1. Multi-page ordering & filtering (dividers and Internal Only Canvas excluded)
    expect(doc.pages).toBeDefined();
    const pages = doc.pages ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(7);
    const pageNames = pages.map((p) => p.name);
    expect(pageNames).not.toContain('Internal Only Canvas');
    expect(pageNames.every((n) => n.trim().length > 0)).toBe(true);

    // First page in Figma is 1:27 ("Дизайн 11.11.2026"), NOT 0:1 ("Обложка")
    expect(pages[0]?.id).toBe('1:27');
    expect(doc.activePageId).toBe('1:27');
    expect(doc.background).toBe('#6b6b6b');

    // 2. Global sanity checks across all pages
    let totalNodes = 0;
    let imageFillCount = 0;
    let cropFillCount = 0;
    let tileFillCount = 0;
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
            const img = f as { url?: string; mode?: string; imageTransform?: number[] };
            if ((img.url ?? '').startsWith('blob:') || (img.url ?? '').startsWith('data:image/')) {
              imageFillCount++;
            }
            if (img.mode === 'crop' && Array.isArray(img.imageTransform)) cropFillCount++;
            if (img.mode === 'tile') tileFillCount++;
          }
        }
      });
    }

    expect(totalNodes).toBeGreaterThan(20000);
    expect(imageFillCount).toBeGreaterThan(100);
    expect(cropFillCount).toBeGreaterThan(20);
    expect(tileFillCount).toBeGreaterThan(20);
    expect(pathCount).toBeGreaterThan(5000);
    expect(nonFiniteCount).toBe(0);

    // 3. Page 1:27 ("Дизайн 11.11.2026") — overrideKey buttons, flips, masks, rich text, custom font glyphs
    const page127 = pages.find((p) => p.id === '1:27')!;
    expect(page127).toBeDefined();
    const laidOut127 = layoutDocument({ version: '1.0', children: page127.children });

    // Wrapped social chips keep exact precomputed position
    const tiktokChip = findByIdOrSuffix(laidOut127.children, '1193:1087');
    expect(tiktokChip?.x).toBeCloseTo(0, 0);
    expect(tiktokChip?.y).toBeCloseTo(41, 0);

    // Instance override via overrideKey (219:1780 -> 652:15): button text & fill
    const supportBtn = findByIdOrSuffix(laidOut127.children, '1193:1015');
    expect(supportBtn?.type).toBe('frame');
    if (supportBtn?.type === 'frame') {
      const btnText = supportBtn.children?.find((c) => c.type === 'text');
      expect(btnText?.type === 'text' ? btnText.content : '').toBe('Написать в поддержку');
    }

    const catalogBtn = findByIdOrSuffix(laidOut127.children, '1133:14412');
    if (catalogBtn?.type === 'frame') {
      const btnText = catalogBtn.children?.find((c) => c.type === 'text');
      expect(btnText?.type === 'text' ? btnText.content : '').toBe('Перейти в каталог');
    }

    // Circular "Подробнее" button 1133:14518: root override clears fillPaints -> undefined fill, 2px lime stroke, unstretched child text
    const circleBtn = findByIdOrSuffix(laidOut127.children, '1133:14518');
    expect(circleBtn?.type).toBe('frame');
    if (circleBtn?.type === 'frame') {
      expect(circleBtn.width).toBe(166);
      expect(circleBtn.height).toBe(166);
      expect(circleBtn.fill).toBeUndefined();
      expect(circleBtn.stroke?.thickness).toBe(2);
      const label = circleBtn.children?.find((c) => c.type === 'text');
      expect(label?.type).toBe('text');
      if (label?.type === 'text') {
        expect(label.content).toBe('Подробнее');
        expect(label.width).toBeCloseTo(86, 0);
        expect(label.height).toBeCloseTo(16, 0);
      }
    }

    // Flipped & rotated nodes on 1:27
    const flippedPhoto = findByIdOrSuffix(laidOut127.children, '1133:14517');
    expect(flippedPhoto?.flipX).toBe(true);
    const vFlippedDoodle = findByIdOrSuffix(laidOut127.children, '1133:14702');
    expect(vFlippedDoodle?.flipY).toBe(true);
    const rotatedInst = findByIdOrSuffix(laidOut127.children, '1133:14415');
    expect(Math.abs(rotatedInst?.rotation ?? 0)).toBeGreaterThan(45);

    // Header crown logo mask (678:77)
    const crownMask = findByIdOrSuffix(laidOut127.children, '678:77');
    expect(crownMask?.mask).toBe(true);

    // Rich text color spans ("на экскурсии и квесты,") + NauryzRedKeds vector glyph outlines
    const richLine = findByIdOrSuffix(laidOut127.children, '1133:14621');
    expect(richLine?.type).toBe('text');
    if (richLine?.type === 'text') {
      expect(richLine.spans?.some((s) => s.fill === '#c8ff32' && s.text.includes('квесты'))).toBe(true);
      expect((richLine.glyphOutlines?.length ?? 0)).toBeGreaterThanOrEqual(2);
    }

    const displayHeading = findByIdOrSuffix(laidOut127.children, '1133:14491');
    expect(displayHeading?.type).toBe('text');
    if (displayHeading?.type === 'text') {
      expect(displayHeading.fontFamily).toBe('NauryzRedKeds');
      expect((displayHeading.glyphOutlines?.[0]?.d.length ?? 0)).toBeGreaterThan(100);
    }

    // 4. Page 0:1 ("⚡️ Обложка") — precomputed badge height 106px, Component Set dashed stroke, PP Neue Machina glyphs
    const page01 = pages.find((p) => p.id === '0:1')!;
    expect(page01).toBeDefined();
    const laidOut01 = layoutDocument({ version: '1.0', children: page01.children });
    const statusBadge = findByIdOrSuffix(laidOut01.children, '6:18');
    expect(statusBadge?.type).toBe('frame');
    if (statusBadge?.type === 'frame') {
      expect(statusBadge.width).toBe(260);
      expect(statusBadge.height).toBe(106);
    }
    const statusSet = findByIdOrSuffix(laidOut01.children, '6:7');
    if (statusSet?.type === 'frame') {
      expect(statusSet.stroke?.dashPattern).toEqual([10, 5]);
    }
    const coverTitle = findByIdOrSuffix(laidOut01.children, '1:5');
    if (coverTitle?.type === 'text') {
      expect(coverTitle.fontFamily).toBe('PP Neue Machina');
      expect((coverTitle.glyphOutlines?.length ?? 0)).toBeGreaterThan(0);
    }

    // 5. Page 1:23 ("📝  Прототип") — SECTION container and bulleted UNORDERED_LIST text
    const page123 = pages.find((p) => p.id === '1:23')!;
    expect(page123).toBeDefined();
    const sectionNode = findByIdOrSuffix(page123.children, '615:10079');
    expect(sectionNode?.type).toBe('frame');
    if (sectionNode?.type === 'frame') {
      expect(sectionNode.isSection).toBe(true);
    }
    const bulletText = findByIdOrSuffix(page123.children, '693:946');
    if (bulletText?.type === 'text') {
      expect(bulletText.content?.startsWith('• ')).toBe(true);
    }

    // 6. Page 1:25 ("💡 Процесс") — multi-color vector network, donut arc ellipse, rotated zero-height line, star
    const page125 = pages.find((p) => p.id === '1:25')!;
    expect(page125).toBeDefined();
    const multiColorVec = findByIdOrSuffix(page125.children, '1061:2256');
    expect(multiColorVec?.type).toBe('group');
    if (multiColorVec?.type === 'group') {
      expect((multiColorVec.children?.length ?? 0)).toBeGreaterThanOrEqual(2);
    }
    const arcEllipse = findByIdOrSuffix(page125.children, '1061:13014');
    expect(arcEllipse?.type).toBe('ellipse');
    if (arcEllipse?.type === 'ellipse') {
      expect(arcEllipse.innerRadius).toBeCloseTo(0.75, 2);
    }
    const vertDashedLine = findByIdOrSuffix(page125.children, '1061:13596');
    expect(vertDashedLine?.type).toBe('line');
    if (vertDashedLine?.type === 'line') {
      expect(Math.abs(vertDashedLine.rotation ?? 0)).toBeCloseTo(90, 0);
      expect(vertDashedLine.stroke?.dashPattern).toEqual([4, 4]);
    }
    const sunburstStar = findByIdOrSuffix(page125.children, '1080:20912');
    expect(sunburstStar?.type).toBe('path');

    // 7. Three-dots icon instance (Menu / More_Horizontal) does not inherit master icon layoutGrids and renders round SVG stroke
    const moreIconFrame = findByIdOrSuffix(laidOut127.children, '1133:14695__1076:14082');
    expect(moreIconFrame?.type).toBe('frame');
    if (moreIconFrame?.type === 'frame') {
      expect(moreIconFrame.layoutGrids).toBeUndefined();
      const dotsVec = moreIconFrame.children?.[0];
      expect(dotsVec?.type).toBe('path');
      if (dotsVec?.type === 'path') {
        expect(dotsVec.stroke?.cap).toBe('round');
        expect(dotsVec.stroke?.thickness).toBe(2);
      }
    }

    // 8. Independent corner radii with 0-radius top corners omitted in Kiwi (Квесты -> 1177:8777 => [0, 0, 64, 64])
    const questsWhiteFrame = findByIdOrSuffix(page127.children, '1177:8777');
    expect(questsWhiteFrame?.type).toBe('frame');
    if (questsWhiteFrame?.type === 'frame') {
      expect(questsWhiteFrame.cornerRadius).toEqual([0, 0, 64, 64]);
    }
  });
});
