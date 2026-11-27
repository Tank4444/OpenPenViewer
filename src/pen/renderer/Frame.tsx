/**
 * Frame レンダラ。layout 計算は layout/flex.ts 側で済んでいる前提。
 * ここでは: 背景 fill の描画、clipPath、子の再帰描画を担う。
 */

import type { CSSProperties } from 'react';
import type { FrameNode } from '../types';
import { usePaintRegistry } from '../paint/PaintContext';
import {
  resolveFillLayers,
  resolveStroke,
  resolveStrokeWidth,
  resolveStrokeAttrs,
  resolveFilter,
  hasPartialStroke,
  resolvePartialStroke,
} from './paint';
import { LayoutGridOverlay } from '../../components/Viewer/LayoutGridOverlay';
import { isCornerRadiusArray, roundedRectPath } from './roundedRectPath';
import { renderMaskedChildren } from './MaskedChildren';

export function Frame({ node }: { node: FrameNode }) {
  const registry = usePaintRegistry() ?? undefined;
  const ctx = { nodeId: node.id, registry };
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const width = typeof node.width === 'number' ? node.width : undefined;
  const height = typeof node.height === 'number' ? node.height : undefined;
  const opacity = node.opacity ?? 1;
  const clipId = node.clip ? `clip-${node.id}` : undefined;
  const transform = x === 0 && y === 0 ? undefined : `translate(${x} ${y})`;

  const fillLayers = resolveFillLayers(node.fill, ctx);
  const filter = resolveFilter(ctx);
  const rawCr = node.cornerRadius;
  const crArr = isCornerRadiusArray(rawCr) ? rawCr : null;
  const rawRx = typeof rawCr === 'number' ? rawCr : undefined;
  const rx = rawRx != null && width != null && height != null
    ? Math.min(rawRx, width / 2, height / 2)
    : rawRx;

  const partial = resolvePartialStroke(node.stroke);
  const isPartial = hasPartialStroke(node.stroke);
  const strokeColor = resolveStroke(node.stroke, ctx);
  const strokeWidth = isPartial ? 0 : resolveStrokeWidth(node.stroke);
  const strokeAttrs = resolveStrokeAttrs(node.stroke);
  const hasUniformStroke = !isPartial && strokeWidth > 0 && strokeColor !== 'none';

  const align = node.stroke?.align ?? 'center';
  const sw2 = strokeWidth / 2;
  const strokeBox =
    width != null && height != null
      ? align === 'inside'
        ? { x: sw2, y: sw2, w: Math.max(0, width - strokeWidth), h: Math.max(0, height - strokeWidth) }
        : align === 'outside'
          ? { x: -sw2, y: -sw2, w: width + strokeWidth, h: height + strokeWidth }
          : { x: 0, y: 0, w: width, h: height }
      : null;
  const strokeRx =
    rx != null
      ? Math.max(0, align === 'inside' ? rx - sw2 : align === 'outside' ? rx + sw2 : rx)
      : undefined;
  const strokeCrArr = crArr
    ? (crArr.map((r) =>
        r <= 0 ? 0 : Math.max(0, align === 'inside' ? r - sw2 : align === 'outside' ? r + sw2 : r),
      ) as [
        number,
        number,
        number,
        number,
      ])
    : null;

  const content = (
    <g
      clipPath={clipId ? `url(#${clipId})` : undefined}
      filter={filter}
    >
      {clipId && width != null && height != null && (
        <defs>
          <clipPath id={clipId}>
            {crArr ? (
              <path d={roundedRectPath(0, 0, width, height, crArr)} />
            ) : (
              <rect x={0} y={0} width={width} height={height} rx={rx} ry={rx} />
            )}
          </clipPath>
        </defs>
      )}
      {width != null && height != null && crArr && fillLayers.map((l, i) => (
        <path
          key={`bg-${i}`}
          d={roundedRectPath(0, 0, width, height, crArr)}
          fill={l.paint}
          fillOpacity={l.opacity !== 1 ? l.opacity : undefined}
          style={l.blendMode ? ({ mixBlendMode: l.blendMode } as CSSProperties) : undefined}
        />
      ))}
      {width != null && height != null && !crArr && fillLayers.map((l, i) => (
        <rect
          key={`bg-${i}`}
          x={0}
          y={0}
          width={width}
          height={height}
          rx={rx}
          ry={rx}
          fill={l.paint}
          fillOpacity={l.opacity !== 1 ? l.opacity : undefined}
          style={l.blendMode ? ({ mixBlendMode: l.blendMode } as CSSProperties) : undefined}
        />
      ))}
      <LayoutGridOverlay frame={node} />
      {node.children && renderMaskedChildren(node.children)}
    </g>
  );

  return (
    <g transform={transform} opacity={opacity}>
      {node.isSection && node.name && (
        <text
          x={4}
          y={-10}
          fontSize={16}
          fontWeight={600}
          fontFamily="Inter, system-ui, sans-serif"
          fill="#9CA3AF"
          pointerEvents="none"
        >
          {node.name}
        </text>
      )}
      {content}
      {hasUniformStroke && strokeBox && (
        strokeCrArr ? (
          <path
            d={roundedRectPath(strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeCrArr)}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            {...strokeAttrs}
            pointerEvents="none"
          />
        ) : (
          <rect
            x={strokeBox.x}
            y={strokeBox.y}
            width={strokeBox.w}
            height={strokeBox.h}
            rx={strokeRx}
            ry={strokeRx}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            {...strokeAttrs}
            pointerEvents="none"
          />
        )
      )}
      {isPartial && partial && width != null && height != null && strokeColor !== 'none' && (
        <>
          {partial.top > 0 && (
            <line x1={0} y1={0} x2={width} y2={0} stroke={strokeColor} strokeWidth={partial.top} {...strokeAttrs} />
          )}
          {partial.bottom > 0 && (
            <line x1={0} y1={height} x2={width} y2={height} stroke={strokeColor} strokeWidth={partial.bottom} {...strokeAttrs} />
          )}
          {partial.left > 0 && (
            <line x1={0} y1={0} x2={0} y2={height} stroke={strokeColor} strokeWidth={partial.left} {...strokeAttrs} />
          )}
          {partial.right > 0 && (
            <line x1={width} y1={0} x2={width} y2={height} stroke={strokeColor} strokeWidth={partial.right} {...strokeAttrs} />
          )}
        </>
      )}
    </g>
  );
}
