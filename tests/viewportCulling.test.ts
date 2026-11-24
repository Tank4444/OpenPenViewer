import { describe, it, expect } from 'vitest';
import { filterVisibleTopLevelNodes } from '../src/components/Viewer/viewportCulling';
import type { PenNode } from '../src/pen/types';
import type { ViewBox } from '../src/pen/renderer/viewBox';

describe('filterVisibleTopLevelNodes', () => {
  const nodes: PenNode[] = [
    {
      type: 'frame',
      id: 'screen-left',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      children: [{ type: 'text', id: 'left-text', x: 10, y: 10, width: 100, height: 20, content: 'A' }],
    },
    {
      type: 'frame',
      id: 'screen-far-right',
      x: 5000,
      y: 0,
      width: 390,
      height: 844,
      children: [{ type: 'text', id: 'right-text', x: 10, y: 10, width: 100, height: 20, content: 'B' }],
    },
    {
      type: 'group',
      id: 'unsized-group',
      x: 9000,
      y: 0,
      children: [],
    },
  ];

  const vb: ViewBox = { x: 0, y: 0, width: 800, height: 900 };

  it('keeps visible nodes and unsized nodes while culling off-screen frames', () => {
    const visible = filterVisibleTopLevelNodes(nodes, vb, null);
    expect(visible.map((n) => n.id)).toEqual(['screen-left', 'unsized-group']);
  });

  it('keeps an off-screen frame if it contains the selected node', () => {
    const visible = filterVisibleTopLevelNodes(nodes, vb, 'right-text');
    expect(visible.map((n) => n.id)).toEqual(['screen-left', 'screen-far-right', 'unsized-group']);
  });
});
