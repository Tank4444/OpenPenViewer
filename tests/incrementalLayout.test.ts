import { describe, it, expect } from 'vitest';
import { IncrementalLayoutCache } from '../src/pen/layout/incrementalLayout';
import type { PenDocument, PenNode } from '../src/pen/types';

function makeScreen(id: string, x: number): PenNode {
  return {
    type: 'frame',
    id,
    name: id,
    x,
    y: 0,
    width: 390,
    height: 844,
    layout: 'vertical',
    children: [
      {
        type: 'rectangle',
        id: `${id}-box`,
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: '#4f46e5',
      },
    ],
  };
}

describe('IncrementalLayoutCache', () => {
  it('only recomputes the modified top-level screen and reuses untouched screens in O(1)', () => {
    const cache = new IncrementalLayoutCache();
    const s1 = makeScreen('s1', 0);
    const s2 = makeScreen('s2', 440);
    const s3 = makeScreen('s3', 880);
    const doc1: PenDocument = { version: '1.0', children: [s1, s2, s3] };

    const out1 = cache.compute(doc1, 0);
    expect(cache.lastRecomputedNodes).toBe(3);

    // Identical rawDoc: 0 recomputations
    const outSame = cache.compute(doc1, 0);
    expect(cache.lastRecomputedNodes).toBe(0);
    expect(outSame.children[0]).toBe(out1.children[0]);
    expect(outSame.children[1]).toBe(out1.children[1]);
    expect(outSame.children[2]).toBe(out1.children[2]);

    // Mutate only screen 2: only 1 recomputation, screens 1 & 3 keep exact same references
    const s2Updated: PenNode = { ...s2, x: 500 };
    const doc2: PenDocument = { version: '1.0', children: [s1, s2Updated, s3] };
    const out2 = cache.compute(doc2, 0);
    expect(cache.lastRecomputedNodes).toBe(1);
    expect(out2.children[0]).toBe(out1.children[0]);
    expect(out2.children[1]).not.toBe(out1.children[1]);
    expect(out2.children[1].x).toBe(500);
    expect(out2.children[2]).toBe(out1.children[2]);

    // Variable change invalidates all screens
    const doc3: PenDocument = {
      ...doc2,
      variables: { primary: { type: 'color', value: '#ff0000' } },
    };
    cache.compute(doc3, 0);
    expect(cache.lastRecomputedNodes).toBe(3);
  });
});

