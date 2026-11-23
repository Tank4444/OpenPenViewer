import { describe, it, expect } from 'vitest';
import { figColorToHex, figToPen, hexToFigColor, penToFig } from '../src/pen/figma/figConverter';
import { parseFigFile } from '../src/pen/figma/figKiwi';
import type { PenDocument } from '../src/pen/types';

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
});
