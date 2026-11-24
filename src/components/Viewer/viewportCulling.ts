import type { PenNode } from '../../pen/types';
import type { ViewBox } from '../../pen/renderer/viewBox';

function containsNodeId(node: PenNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  const children = (node as { children?: PenNode[] }).children;
  if (!Array.isArray(children)) return false;
  for (const child of children) {
    if (containsNodeId(child, targetId)) return true;
  }
  return false;
}

/**
 * Filters top-level document nodes against an expanded viewport rectangle.
 * Nodes without explicit numeric dimensions or containing the active selection
 * are always kept so editing/selection never disappears off-screen.
 */
export function filterVisibleTopLevelNodes(
  nodes: PenNode[],
  viewBox: ViewBox | undefined,
  selectedNodeId: string | null,
  marginRatio = 0.25,
): PenNode[] {
  if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) {
    return nodes;
  }

  const padX = viewBox.width * marginRatio;
  const padY = viewBox.height * marginRatio;
  const minX = viewBox.x - padX;
  const minY = viewBox.y - padY;
  const maxX = viewBox.x + viewBox.width + padX;
  const maxY = viewBox.y + viewBox.height + padY;

  return nodes.filter((node) => {
    const w = (node as { width?: unknown }).width;
    const h = (node as { height?: unknown }).height;
    if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) {
      return true;
    }

    if (selectedNodeId && containsNodeId(node, selectedNodeId)) {
      return true;
    }

    const nx = typeof node.x === 'number' ? node.x : 0;
    const ny = typeof node.y === 'number' ? node.y : 0;
    return nx + w >= minX && nx <= maxX && ny + h >= minY && ny <= maxY;
  });
}
