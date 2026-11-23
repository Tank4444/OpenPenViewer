import { describe, it, expect } from 'vitest';
import {
  collectWorldRects,
  computeMeasurements,
  findHitNodeId,
  type WorldRect,
} from '../src/components/Viewer/distanceMeasureMath';
import type { PenNode } from '../src/pen/types';

describe('DistanceMeasure helpers', () => {
  const sampleTree: PenNode[] = [
    {
      type: 'frame',
      id: 'screen',
      x: 100,
      y: 200,
      width: 390,
      height: 844,
      children: [
        {
          type: 'text',
          id: 'title',
          x: 24,
          y: 40,
          width: 200,
          height: 30,
          content: 'Title',
        },
        {
          type: 'frame',
          id: 'card',
          x: 24,
          y: 90,
          width: 342,
          height: 120,
          children: [
            {
              type: 'rectangle',
              id: 'btn',
              x: 16,
              y: 20,
              width: 100,
              height: 44,
            },
          ],
        },
      ],
    },
  ];

  it('collects nested nodes with accumulated world coordinates', () => {
    const rects = collectWorldRects(sampleTree);
    expect(rects).toHaveLength(4);

    const screen = rects.find((r) => r.id === 'screen');
    const title = rects.find((r) => r.id === 'title');
    const btn = rects.find((r) => r.id === 'btn');

    expect(screen).toMatchObject({ x: 100, y: 200, width: 390, height: 844, depth: 0 });
    expect(title).toMatchObject({ x: 124, y: 240, width: 200, height: 30, depth: 1 });
    expect(btn).toMatchObject({ x: 140, y: 310, width: 100, height: 44, depth: 2 });
  });

  it('hits deepest child under pointer and falls back to parent frame on empty space', () => {
    const rects = collectWorldRects(sampleTree);

    // Point inside btn (140..240, 310..354)
    expect(findHitNodeId(rects, { x: 160, y: 330 }, 'title')).toBe('btn');

    // Point on empty area inside screen frame (110, 500)
    expect(findHitNodeId(rects, { x: 110, y: 500 }, 'btn')).toBe('screen');

    // When btn is selected and pointer is on btn itself, it skips selected and hits card
    expect(findHitNodeId(rects, { x: 160, y: 330 }, 'btn')).toBe('card');
  });

  it('computes all 4 edge distances when selected node is inside parent container', () => {
    const screen: WorldRect = { id: 'screen', x: 0, y: 0, width: 390, height: 844, depth: 0 };
    const button: WorldRect = { id: 'btn', x: 24, y: 100, width: 342, height: 48, depth: 1 };

    const { lines, labels } = computeMeasurements(button, screen);
    const labelMap = Object.fromEntries(labels.map((l) => [l.key, l.text]));

    expect(lines).toHaveLength(4);
    expect(labelMap['in-top-lbl']).toBe('100');
    expect(labelMap['in-bottom-lbl']).toBe('696');
    expect(labelMap['in-left-lbl']).toBe('24');
    expect(labelMap['in-right-lbl']).toBe('24');
  });

  it('computes vertical and horizontal gaps between two sibling nodes', () => {
    const title: WorldRect = { id: 'title', x: 124, y: 240, width: 200, height: 30, depth: 1 };
    const subtitle: WorldRect = { id: 'sub', x: 124, y: 286, width: 150, height: 20, depth: 1 };

    const { lines, labels } = computeMeasurements(title, subtitle);
    expect(lines).toHaveLength(1);
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('16');
  });
});

