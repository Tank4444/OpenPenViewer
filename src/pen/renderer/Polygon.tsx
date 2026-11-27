import type { PolygonNode } from '../types';
import { usePaintRegistry } from '../paint/PaintContext';
import {
  resolveFill,
  resolveStroke,
  resolveFilter,
  resolveStrokeWidth,
  resolveStrokeAttrs,
} from './paint';

export function Polygon({ node }: { node: PolygonNode }) {
  const registry = usePaintRegistry() ?? undefined;
  const ctx = { nodeId: node.id, registry };
  const width = typeof node.width === 'number' ? node.width : 0;
  const height = typeof node.height === 'number' ? node.height : 0;
  const sides = Math.max(3, node.polygonCount ?? 3);
  const cx = (node.x ?? 0) + width / 2;
  const cy = (node.y ?? 0) + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const innerRatio =
    typeof node.innerRadius === 'number' && node.innerRadius > 0 && node.innerRadius < 1
      ? node.innerRadius
      : undefined;

  const points: string[] = [];
  if (innerRatio !== undefined) {
    const totalVerts = sides * 2;
    for (let i = 0; i < totalVerts; i++) {
      const angle = -Math.PI / 2 + (Math.PI * i) / sides;
      const scale = i % 2 === 0 ? 1 : innerRatio;
      const px = cx + rx * scale * Math.cos(angle);
      const py = cy + ry * scale * Math.sin(angle);
      points.push(`${px.toFixed(3)},${py.toFixed(3)}`);
    }
  } else {
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / sides;
      const px = cx + rx * Math.cos(angle);
      const py = cy + ry * Math.sin(angle);
      points.push(`${px.toFixed(3)},${py.toFixed(3)}`);
    }
  }

  const strokeAttrs = resolveStrokeAttrs(node.stroke);
  return (
    <polygon
      points={points.join(' ')}
      fill={resolveFill(node.fill, ctx)}
      stroke={resolveStroke(node.stroke, ctx)}
      strokeWidth={resolveStrokeWidth(node.stroke)}
      {...strokeAttrs}
      filter={resolveFilter(ctx)}
    />
  );
}
