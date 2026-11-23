import type { PenNode } from '../../pen/types';

export interface WorldRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface MeasureLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  key: string;
  dashed?: boolean;
}

export interface MeasureLabel {
  x: number;
  y: number;
  text: string;
  key: string;
}

export interface MeasurementResult {
  lines: MeasureLine[];
  labels: MeasureLabel[];
}

export function collectWorldRects(
  nodes: PenNode[],
  offsetX = 0,
  offsetY = 0,
  depth = 0,
  out: WorldRect[] = [],
): WorldRect[] {
  for (const n of nodes) {
    if ((n as { enabled?: boolean }).enabled === false) continue;
    const nx = offsetX + (typeof n.x === 'number' ? n.x : 0);
    const ny = offsetY + (typeof n.y === 'number' ? n.y : 0);
    const w = typeof (n as { width?: unknown }).width === 'number' ? (n as { width: number }).width : 0;
    const h = typeof (n as { height?: unknown }).height === 'number' ? (n as { height: number }).height : 0;

    if (w > 0 && h > 0) {
      out.push({ id: n.id, x: nx, y: ny, width: w, height: h, depth });
    }

    const children = (n as { children?: PenNode[] }).children;
    if (Array.isArray(children) && children.length > 0) {
      collectWorldRects(children, nx, ny, depth + 1, out);
    }
  }
  return out;
}

export function findHitNodeId(
  rects: WorldRect[],
  pt: { x: number; y: number },
  excludeId: string | null,
): string | null {
  // Iterate backwards so topmost / deepest painted nodes win
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (r.id === excludeId) continue;
    if (pt.x >= r.x && pt.x <= r.x + r.width && pt.y >= r.y && pt.y <= r.y + r.height) {
      return r.id;
    }
  }
  return null;
}

function isContainedIn(inner: WorldRect, outer: WorldRect): boolean {
  return (
    inner.x >= outer.x - 0.01 &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01
  );
}

interface Gaps {
  horizontal: number;
  vertical: number;
  horizontalOverlap: [number, number] | null;
  verticalOverlap: [number, number] | null;
  xDir: 'right' | 'left' | 'overlap';
  yDir: 'down' | 'up' | 'overlap';
}

function computeGaps(a: WorldRect, b: WorldRect): Gaps {
  const aLeft = a.x;
  const aRight = a.x + a.width;
  const aTop = a.y;
  const aBottom = a.y + a.height;
  const bLeft = b.x;
  const bRight = b.x + b.width;
  const bTop = b.y;
  const bBottom = b.y + b.height;

  let horizontal = 0;
  let xDir: Gaps['xDir'] = 'overlap';
  if (aRight <= bLeft) {
    horizontal = bLeft - aRight;
    xDir = 'right';
  } else if (bRight <= aLeft) {
    horizontal = aLeft - bRight;
    xDir = 'left';
  }

  let vertical = 0;
  let yDir: Gaps['yDir'] = 'overlap';
  if (aBottom <= bTop) {
    vertical = bTop - aBottom;
    yDir = 'down';
  } else if (bBottom <= aTop) {
    vertical = aTop - bBottom;
    yDir = 'up';
  }

  const hOvLow = Math.max(aLeft, bLeft);
  const hOvHigh = Math.min(aRight, bRight);
  const vOvLow = Math.max(aTop, bTop);
  const vOvHigh = Math.min(aBottom, bBottom);

  return {
    horizontal,
    vertical,
    horizontalOverlap: hOvLow < hOvHigh ? [hOvLow, hOvHigh] : null,
    verticalOverlap: vOvLow < vOvHigh ? [vOvLow, vOvHigh] : null,
    xDir,
    yDir,
  };
}

export function computeMeasurements(selected: WorldRect, hovered: WorldRect): MeasurementResult {
  const lines: MeasureLine[] = [];
  const labels: MeasureLabel[] = [];

  // Case 1: One rect is inside the other (e.g. button inside a mobile screen frame)
  const inner = isContainedIn(selected, hovered)
    ? selected
    : isContainedIn(hovered, selected)
      ? hovered
      : null;
  const outer = inner === selected ? hovered : inner === hovered ? selected : null;

  if (inner && outer) {
    const cx = inner.x + inner.width / 2;
    const cy = inner.y + inner.height / 2;

    const topGap = inner.y - outer.y;
    const bottomGap = outer.y + outer.height - (inner.y + inner.height);
    const leftGap = inner.x - outer.x;
    const rightGap = outer.x + outer.width - (inner.x + inner.width);

    if (topGap > 0.5) {
      lines.push({ x1: cx, y1: outer.y, x2: cx, y2: inner.y, key: 'in-top' });
      labels.push({ x: cx, y: outer.y + topGap / 2, text: `${Math.round(topGap)}`, key: 'in-top-lbl' });
    }
    if (bottomGap > 0.5) {
      const innerBottom = inner.y + inner.height;
      const outerBottom = outer.y + outer.height;
      lines.push({ x1: cx, y1: innerBottom, x2: cx, y2: outerBottom, key: 'in-bottom' });
      labels.push({ x: cx, y: innerBottom + bottomGap / 2, text: `${Math.round(bottomGap)}`, key: 'in-bottom-lbl' });
    }
    if (leftGap > 0.5) {
      lines.push({ x1: outer.x, y1: cy, x2: inner.x, y2: cy, key: 'in-left' });
      labels.push({ x: outer.x + leftGap / 2, y: cy, text: `${Math.round(leftGap)}`, key: 'in-left-lbl' });
    }
    if (rightGap > 0.5) {
      const innerRight = inner.x + inner.width;
      const outerRight = outer.x + outer.width;
      lines.push({ x1: innerRight, y1: cy, x2: outerRight, y2: cy, key: 'in-right' });
      labels.push({ x: innerRight + rightGap / 2, y: cy, text: `${Math.round(rightGap)}`, key: 'in-right-lbl' });
    }

    return { lines, labels };
  }

  // Case 2: Separate or partially overlapping rects
  const gaps = computeGaps(selected, hovered);

  if (gaps.xDir !== 'overlap' && gaps.horizontal > 0.5) {
    const yMid = gaps.verticalOverlap
      ? (gaps.verticalOverlap[0] + gaps.verticalOverlap[1]) / 2
      : selected.y + selected.height / 2;
    const xStart = gaps.xDir === 'right' ? selected.x + selected.width : hovered.x + hovered.width;
    const xEnd = gaps.xDir === 'right' ? hovered.x : selected.x;
    lines.push({ x1: xStart, y1: yMid, x2: xEnd, y2: yMid, key: 'h-main' });

    if (!gaps.verticalOverlap) {
      const hoveredEdgeX = gaps.xDir === 'right' ? hovered.x : hovered.x + hovered.width;
      const hoveredEdgeY = gaps.yDir === 'down' ? hovered.y : hovered.y + hovered.height;
      lines.push({
        x1: hoveredEdgeX,
        y1: hoveredEdgeY,
        x2: hoveredEdgeX,
        y2: yMid,
        key: 'h-hov-ext',
        dashed: true,
      });
    }

    labels.push({
      x: (xStart + xEnd) / 2,
      y: yMid,
      text: `${Math.round(gaps.horizontal)}`,
      key: 'h-label',
    });
  }

  if (gaps.yDir !== 'overlap' && gaps.vertical > 0.5) {
    const xMid = gaps.horizontalOverlap
      ? (gaps.horizontalOverlap[0] + gaps.horizontalOverlap[1]) / 2
      : selected.x + selected.width / 2;
    const yStart = gaps.yDir === 'down' ? selected.y + selected.height : hovered.y + hovered.height;
    const yEnd = gaps.yDir === 'down' ? hovered.y : selected.y;
    lines.push({ x1: xMid, y1: yStart, x2: xMid, y2: yEnd, key: 'v-main' });

    if (!gaps.horizontalOverlap) {
      const hoveredEdgeX = gaps.xDir === 'right' ? hovered.x : hovered.x + hovered.width;
      const hoveredEdgeY = gaps.yDir === 'down' ? hovered.y : hovered.y + hovered.height;
      lines.push({
        x1: hoveredEdgeX,
        y1: hoveredEdgeY,
        x2: xMid,
        y2: hoveredEdgeY,
        key: 'v-hov-ext',
        dashed: true,
      });
    }

    labels.push({
      x: xMid,
      y: (yStart + yEnd) / 2,
      text: `${Math.round(gaps.vertical)}`,
      key: 'v-label',
    });
  }

  return { lines, labels };
}

