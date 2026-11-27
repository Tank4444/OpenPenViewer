import type { CSSProperties } from 'react';
import type { EllipseNode } from '../types';
import { usePaintRegistry } from '../paint/PaintContext';
import {
  resolveFillLayers,
  resolveStroke,
  resolveFilter,
  resolveStrokeWidth,
  resolveStrokeAttrs,
} from './paint';

function buildArcOrDonutPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  innerRatio: number,
  startDeg: number,
  sweepDeg: number,
  closeCenterForPie: boolean,
): { d: string; evenOdd: boolean } {
  const f = (n: number) => Number(n.toFixed(3));
  const ir = Math.max(0, Math.min(0.999, innerRatio));
  const irx = rx * ir;
  const iry = ry * ir;
  const isFullCircle = Math.abs(sweepDeg) >= 359.99;

  if (isFullCircle) {
    // Full donut ring: outer clockwise + inner counter-clockwise
    const outer = `M ${f(cx - rx)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 1 ${f(cx + rx)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 1 ${f(cx - rx)} ${f(cy)} Z`;
    const inner =
      ir > 0
        ? ` M ${f(cx - irx)} ${f(cy)} A ${f(irx)} ${f(iry)} 0 1 0 ${f(cx + irx)} ${f(cy)} A ${f(irx)} ${f(iry)} 0 1 0 ${f(cx - irx)} ${f(cy)} Z`
        : '';
    return { d: outer + inner, evenOdd: ir > 0 };
  }

  const a0 = (startDeg * Math.PI) / 180;
  const a1 = ((startDeg + sweepDeg) * Math.PI) / 180;
  const ox0 = cx + rx * Math.cos(a0);
  const oy0 = cy + ry * Math.sin(a0);
  const ox1 = cx + rx * Math.cos(a1);
  const oy1 = cy + ry * Math.sin(a1);
  const largeArc = Math.abs(sweepDeg) > 180 ? 1 : 0;
  const sweepFlag = sweepDeg >= 0 ? 1 : 0;

  if (ir > 0) {
    const ix0 = cx + irx * Math.cos(a0);
    const iy0 = cy + iry * Math.sin(a0);
    const ix1 = cx + irx * Math.cos(a1);
    const iy1 = cy + iry * Math.sin(a1);
    const revSweep = sweepFlag === 1 ? 0 : 1;
    const d = `M ${f(ox0)} ${f(oy0)} A ${f(rx)} ${f(ry)} 0 ${largeArc} ${sweepFlag} ${f(ox1)} ${f(oy1)} L ${f(ix1)} ${f(iy1)} A ${f(irx)} ${f(iry)} 0 ${largeArc} ${revSweep} ${f(ix0)} ${f(iy0)} Z`;
    return { d, evenOdd: false };
  }

  if (closeCenterForPie) {
    const d = `M ${f(ox0)} ${f(oy0)} A ${f(rx)} ${f(ry)} 0 ${largeArc} ${sweepFlag} ${f(ox1)} ${f(oy1)} L ${f(cx)} ${f(cy)} Z`;
    return { d, evenOdd: false };
  }

  const d = `M ${f(ox0)} ${f(oy0)} A ${f(rx)} ${f(ry)} 0 ${largeArc} ${sweepFlag} ${f(ox1)} ${f(oy1)}`;
  return { d, evenOdd: false };
}

export function Ellipse({ node }: { node: EllipseNode }) {
  const registry = usePaintRegistry() ?? undefined;
  const ctx = { nodeId: node.id, registry };
  const width = typeof node.width === 'number' ? node.width : 0;
  const height = typeof node.height === 'number' ? node.height : 0;
  const cx = (node.x ?? 0) + width / 2;
  const cy = (node.y ?? 0) + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const layers = resolveFillLayers(node.fill, ctx);
  const strokeColor = resolveStroke(node.stroke, ctx);
  const strokeWidth = resolveStrokeWidth(node.stroke);
  const strokeAttrs = resolveStrokeAttrs(node.stroke);
  const filter = resolveFilter(ctx);
  const hasStroke = strokeWidth > 0 && strokeColor !== 'none';

  const innerRatio = node.innerRadius ?? 0;
  const hasArc =
    innerRatio > 0.001 ||
    (typeof node.sweepAngle === 'number' && Math.abs(Math.abs(node.sweepAngle) - 360) > 0.05);

  if (hasArc && rx > 0 && ry > 0) {
    const startDeg = node.startAngle ?? 0;
    const sweepDeg = node.sweepAngle ?? 360;
    const { d, evenOdd } = buildArcOrDonutPath(
      cx,
      cy,
      rx,
      ry,
      innerRatio,
      startDeg,
      sweepDeg,
      layers.length > 0,
    );
    return (
      <g filter={filter}>
        {layers.map((l, i) => (
          <path
            key={i}
            d={d}
            fill={l.paint}
            fillOpacity={l.opacity !== 1 ? l.opacity : undefined}
            fillRule={evenOdd ? 'evenodd' : undefined}
            style={l.blendMode ? ({ mixBlendMode: l.blendMode } as CSSProperties) : undefined}
          />
        ))}
        {hasStroke && (
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            {...strokeAttrs}
          />
        )}
      </g>
    );
  }

  const align = node.stroke?.align ?? 'center';
  const sw2 = strokeWidth / 2;
  const sRx = align === 'inside' ? Math.max(0, rx - sw2) : align === 'outside' ? rx + sw2 : rx;
  const sRy = align === 'inside' ? Math.max(0, ry - sw2) : align === 'outside' ? ry + sw2 : ry;

  if (layers.length <= 1 && (align === 'center' || !hasStroke)) {
    const fillPaint = layers[0]?.paint ?? 'none';
    const fillOpacity = layers[0]?.opacity;
    return (
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={fillPaint}
        fillOpacity={fillOpacity != null && fillOpacity !== 1 ? fillOpacity : undefined}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        {...strokeAttrs}
        filter={filter}
      />
    );
  }

  return (
    <g filter={filter}>
      {layers.map((l, i) => (
        <ellipse
          key={i}
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={l.paint}
          fillOpacity={l.opacity !== 1 ? l.opacity : undefined}
          style={l.blendMode ? ({ mixBlendMode: l.blendMode } as CSSProperties) : undefined}
        />
      ))}
      {hasStroke && (
        <ellipse
          cx={cx}
          cy={cy}
          rx={sRx}
          ry={sRy}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          {...strokeAttrs}
        />
      )}
    </g>
  );
}
