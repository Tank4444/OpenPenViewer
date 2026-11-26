import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { figColorToHex, figToPen, hexToFigColor, penToFig } from '../src/pen/figma/figConverter';
import { parseFigFile } from '../src/pen/figma/figKiwi';
import { parsePenText } from '../src/pen/parser';
import { ensureLucideLoaded } from '../src/pen/renderer/lucideIcons';
import { resolveRefs } from '../src/pen/refs';
import { substituteVariables } from '../src/pen/variables';
import { layoutDocument } from '../src/pen/layout';
import type { PenDocument, PenNode } from '../src/pen/types';

describe('Figma (.fig) <-> .pen converter', () => {
  it('converts colors accurately between hex/rgba and FigColor', () => {
    expect(figColorToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(figColorToHex({ r: 0, g: 0.5, b: 1, a: 0.5 })).toBe('#0080ff80');

    const c = hexToFigColor('#38bdf8');
    expect(c.r).toBeCloseTo(0x38 / 255, 2);
    expect(c.g).toBeCloseTo(0xbd / 255, 2);
    expect(c.b).toBeCloseTo(0xf8 / 255, 2);
    expect(c.a).toBe(1);
  });

  it('round-trips a PenDocument through .fig (ZIP + fig-kiwi) and back', () => {
    const doc: PenDocument = {
      version: '1.0',
      children: [
        {
          type: 'frame',
          id: 'screen-1',
          name: 'Login Screen',
          x: 50,
          y: 80,
          width: 390,
          height: 844,
          layout: 'vertical',
          gap: 16,
          padding: [24, 20],
          cornerRadius: 24,
          fill: { type: 'color', color: '#ffffff' },
          children: [
            {
              type: 'text',
              id: 'heading',
              name: 'Title',
              x: 20,
              y: 24,
              width: 350,
              height: 36,
              content: 'Welcome Back',
              fontSize: 28,
              fontFamily: 'Inter',
              fill: { type: 'color', color: '#0f172a' },
            },
            {
              type: 'rectangle',
              id: 'btn-bg',
              name: 'Primary Button',
              x: 20,
              y: 76,
              width: 350,
              height: 48,
              cornerRadius: 12,
              fill: {
                type: 'gradient',
                gradientType: 'linear',
                colors: [
                  { color: '#38bdf8', position: 0 },
                  { color: '#818cf8', position: 1 },
                ],
              },
              effect: [
                {
                  type: 'shadow',
                  shadowType: 'outer',
                  color: '#00000033',
                  offset: { x: 0, y: 4 },
                  blur: 12,
                  spread: 0,
                },
              ],
            },
            {
              type: 'ellipse',
              id: 'avatar',
              name: 'Avatar',
              x: 20,
              y: 140,
              width: 48,
              height: 48,
              fill: { type: 'color', color: '#22c55e' },
            },
          ],
        },
      ],
    };

    const figBytes = penToFig(doc, 'Login Screen');
    expect(figBytes[0]).toBe(0x50); // 'P' (ZIP)
    expect(figBytes[1]).toBe(0x4b); // 'K'

    const parsed = parseFigFile(figBytes);
    expect(parsed.version).toBe(15);
    expect((parsed.message.nodeChanges ?? []).length).toBeGreaterThanOrEqual(6);

    const roundTripped = figToPen(figBytes);
    expect(roundTripped.children).toHaveLength(1);

    const frame = roundTripped.children[0];
    expect(frame.type).toBe('frame');
    if (frame.type === 'frame') {
      expect(frame.name).toBe('Login Screen');
      expect(frame.x).toBe(50);
      expect(frame.y).toBe(80);
      expect(frame.width).toBe(390);
      expect(frame.height).toBe(844);
      expect(frame.layout).toBe('vertical');
      expect(frame.gap).toBe(16);
      expect(frame.cornerRadius).toBe(24);
      const children = frame.children ?? [];
      expect(children).toHaveLength(3);

      const title = children[0];
      expect(title.type).toBe('text');
      if (title.type === 'text') {
        expect(title.content).toBe('Welcome Back');
        expect(title.fontSize).toBe(28);
        expect(title.fontFamily).toBe('Inter');
      }

      const btn = children[1];
      expect(btn.type).toBe('rectangle');
      if (btn.type === 'rectangle') {
        expect(btn.cornerRadius).toBe(12);
      }

      const avatar = children[2];
      expect(avatar.type).toBe('ellipse');
    }
  });

  it('exports resolved RefNode component instances with full children into .fig', () => {
    const rawDoc: PenDocument = {
      version: '1.0',
      children: [
        {
          type: 'frame',
          id: 'btn-comp',
          reusable: true,
          x: 0,
          y: 0,
          width: 200,
          height: 44,
          children: [
            {
              type: 'text',
              id: 'btn-lbl',
              x: 20,
              y: 12,
              width: 160,
              height: 20,
              content: 'Sign In',
            },
          ],
        } as PenNode,
        {
          type: 'ref',
          id: 'btn-inst',
          ref: 'btn-comp',
          x: 40,
          y: 120,
        },
      ],
    };

    const resolved = resolveRefs(rawDoc);
    const figBytes = penToFig(resolved, 'With Component');
    const roundTripped = figToPen(figBytes);

    expect(roundTripped.children).toHaveLength(2);
    const instanceFrame = roundTripped.children[1];
    expect(instanceFrame.type).toBe('frame');
    if (instanceFrame.type === 'frame') {
      expect(instanceFrame.x).toBe(40);
      expect(instanceFrame.y).toBe(120);
      expect(instanceFrame.children).toHaveLength(1);
      const label = instanceFrame.children?.[0];
      expect(label?.type).toBe('text');
      if (label?.type === 'text') {
        expect(label.content).toBe('Sign In');
      }
    }
  });

  it('safely handles justify textAlign, non-standard strokeAlign, and rich text content', () => {
    const doc = {
      version: '1.0',
      children: [
        {
          type: 'text',
          id: 't-justify',
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          content: [{ content: 'Hello ' }, 'World'],
          textAlign: 'justify',
        },
        {
          type: 'rectangle',
          id: 'r-stroke',
          x: 0,
          y: 30,
          width: 80,
          height: 40,
          stroke: { fill: '#111111', thickness: 2, align: 'inner' },
        },
      ],
    } as unknown as PenDocument;

    const bytes = penToFig(doc, 'Edge Cases');
    const roundTripped = figToPen(bytes);
    expect(roundTripped.children).toHaveLength(2);
    const t = roundTripped.children[0];
    if (t.type === 'text') {
      expect(t.content).toBe('Hello World');
      expect(t.textAlign).toBe('justified');
    }
  });

  it('exports all bundled sample .pen files and pencil_viewer.pen without throwing', () => {
    const samplesDir = path.resolve(process.cwd(), 'public/samples');
    const files = fs
      .readdirSync(samplesDir)
      .filter((f) => f.endsWith('.pen'))
      .map((f) => path.join(samplesDir, f));
    files.push(path.resolve(process.cwd(), 'pencil_viewer.pen'));

    for (const filePath of files) {
      const text = fs.readFileSync(filePath, 'utf-8');
      const parsed = parsePenText(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const doc = layoutDocument(substituteVariables(resolveRefs(parsed.doc)));
      const figBytes = penToFig(doc, path.basename(filePath));
      expect(figBytes.length).toBeGreaterThan(20);
      const back = figToPen(figBytes);
      expect(back.children.length).toBeGreaterThan(0);
    }
  });

  it('exports Material Symbols and Lucide icon_font nodes plus path nodes into .fig', async () => {
    await ensureLucideLoaded();
    const doc: PenDocument = {
      version: '1.0',
      children: [
        {
          type: 'icon_font',
          id: 'mat-icon',
          x: 0,
          y: 0,
          width: 24,
          height: 24,
          iconFontFamily: 'Material Symbols Outlined',
          iconFontName: 'search',
          fill: '#1e1b4b',
        },
        {
          type: 'icon_font',
          id: 'lucide-icon',
          x: 32,
          y: 0,
          width: 24,
          height: 24,
          iconFontFamily: 'lucide',
          iconFontName: 'shopping-cart',
          fill: '#4f46e5',
        },
        {
          type: 'path',
          id: 'vec-path',
          x: 64,
          y: 0,
          width: 24,
          height: 24,
          geometry: 'M 2 12 L 12 2 L 22 12 Z',
          fill: '#22c55e',
        },
      ],
    };

    const figBytes = penToFig(doc, 'Icons & Paths');
    const parsed = parseFigFile(figBytes);
    const changes = parsed.message.nodeChanges ?? [];
    const matNode = changes.find((c) => c.name === 'mat-icon');
    const lucideNode = changes.find((c) => c.name === 'lucide-icon');
    const pathNode = changes.find((c) => c.name === 'vec-path');

    expect(matNode?.type).toBe('FRAME');
    const matVec = changes.find(
      (c) => c.type === 'VECTOR' && c.parentIndex?.guid.localID === matNode?.guid.localID,
    );
    expect(matVec?.vectorData?.vectorNetworkBlob).toBeTypeOf('number');

    expect(lucideNode?.type).toBe('FRAME');
    const lucideVec = changes.find(
      (c) => c.type === 'VECTOR' && c.parentIndex?.guid.localID === lucideNode?.guid.localID,
    );
    expect(lucideVec?.vectorData?.vectorNetworkBlob).toBeTypeOf('number');

    expect(pathNode?.type).toBe('VECTOR');
    expect(pathNode?.vectorData?.vectorNetworkBlob).toBeTypeOf('number');
    expect((parsed.message.blobs as unknown[] | undefined)?.length).toBe(3);

    const roundTripped = figToPen(figBytes);
    const importedLucide = roundTripped.children.find((c) => c.name === 'lucide-icon');
    const importedPath = roundTripped.children.find((c) => c.name === 'vec-path');
    expect(importedLucide?.type).toBe('frame');
    expect(importedPath?.type).toBe('path');
    if (importedLucide?.type === 'frame') {
      expect(importedLucide.width).toBe(24);
      expect(importedLucide.height).toBe(24);
      expect(importedLucide.layout).toBe('none');
      const childVec = importedLucide.children?.[0];
      expect(childVec?.type).toBe('path');
      if (childVec?.type === 'path') {
        expect(childVec.geometry).toContain('M ');
      }
    }
  });

  it('preserves layoutPosition: absolute across .pen -> .fig -> .pen', () => {
    const doc: PenDocument = {
      version: '1.0',
      children: [
        {
          type: 'frame',
          id: 'card-img',
          x: 0,
          y: 0,
          width: 180,
          height: 160,
          layout: 'horizontal',
          children: [
            {
              type: 'rectangle',
              id: 'badge',
              x: 10,
              y: 10,
              width: 44,
              height: 22,
              layoutPosition: 'absolute',
            },
          ],
        },
      ],
    };

    const bytes = penToFig(doc, 'Absolute Pos');
    const back = figToPen(bytes);
    const frame = back.children[0];
    expect(frame.type).toBe('frame');
    if (frame.type === 'frame') {
      const badge = frame.children?.[0];
      expect((badge as { layoutPosition?: string })?.layoutPosition).toBe('absolute');
      expect(badge?.x).toBe(10);
      expect(badge?.y).toBe(10);
    }
  });

  it('preserves 4-sided padding, layout: none, space_around, partial stroke thickness, and mapped Material icons', async () => {
    await ensureLucideLoaded();
    const doc: PenDocument = {
      version: '1.0',
      children: [
        {
          type: 'frame',
          id: 'asym-frame',
          x: 0,
          y: 0,
          width: 300,
          height: 120,
          layout: 'horizontal',
          justifyContent: 'space_around',
          padding: [8, 12, 24, 16],
          stroke: {
            fill: '#e2e8f0',
            thickness: { top: 1, bottom: 2 },
          },
          children: [
            {
              type: 'frame',
              id: 'free-frame',
              x: 0,
              y: 0,
              width: 100,
              height: 80,
              layout: 'none',
              children: [
                {
                  type: 'icon_font',
                  id: 'store-icon',
                  x: 38,
                  y: 28,
                  width: 24,
                  height: 24,
                  iconFontFamily: 'Material Symbols Rounded',
                  iconFontName: 'storefront',
                  fill: '#4f46e5',
                },
              ],
            },
          ],
        },
      ],
    };

    const bytes = penToFig(doc, 'Regression Cases');
    const parsed = parseFigFile(bytes);
    expect((parsed.message.blobs as unknown[] | undefined)?.length).toBe(1);

    const back = figToPen(bytes);
    const outer = back.children[0];
    expect(outer.type).toBe('frame');
    if (outer.type === 'frame') {
      expect(outer.justifyContent).toBe('space_around');
      expect(outer.padding).toEqual([8, 12, 24, 16]);
      expect(outer.stroke?.thickness).toBe(2);

      const inner = outer.children?.[0];
      expect(inner?.type).toBe('frame');
      if (inner?.type === 'frame') {
        expect(inner.layout).toBe('none');
        const iconWrapper = inner.children?.[0];
        expect(iconWrapper?.type).toBe('frame');
        if (iconWrapper?.type === 'frame') {
          expect(iconWrapper.x).toBe(38);
          expect(iconWrapper.y).toBe(28);
          expect(iconWrapper.width).toBe(24);
          expect(iconWrapper.height).toBe(24);
          expect(iconWrapper.children?.[0]?.type).toBe('path');
        }
      }
    }
  });
});
