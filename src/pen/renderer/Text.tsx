import { useSyncExternalStore } from 'react';
import type { TextNode, TextSpan } from '../types';
import { usePaintRegistry } from '../paint/PaintContext';
import { normalizeTextLines } from '../layout/flex';
import { resolveFill, resolveFilter } from './paint';
import {
  getFontAvailabilityVersion,
  isFontFamilyAvailable,
  subscribeFontAvailability,
} from '../../utils/fontLoader';

function applyTextCase(
  s: string | undefined,
  textCase?: 'upper' | 'lower' | 'title' | 'none',
): string | undefined {
  if (!s) return s;
  switch (textCase) {
    case 'upper':
      return s.toUpperCase();
    case 'lower':
      return s.toLowerCase();
    case 'title':
      return s.replace(/(^|\s)(\S)/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
    default:
      return s;
  }
}

function buildFontStack(rawFont?: string): string {
  const trimmed = rawFont?.trim();
  if (!trimmed) return 'Inter, system-ui, sans-serif';
  const hasGeneric = /\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\b/i.test(trimmed);
  return hasGeneric ? trimmed : `"${trimmed.replace(/"/g, '')}", 'Inter', system-ui, sans-serif`;
}

function splitSpansByNewline(spans: TextSpan[]): TextSpan[][] {
  const lines: TextSpan[][] = [[]];
  for (const sp of spans) {
    const parts = sp.text.split(/\r\n|\r|\n/);
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part.length > 0 || parts.length === 1) {
        lines[lines.length - 1].push({ ...sp, text: part });
      }
    });
  }
  return lines;
}

export function Text({ node }: { node: TextNode }) {
  const registry = usePaintRegistry() ?? undefined;
  const ctx = { nodeId: node.id, registry };
  useSyncExternalStore(
    subscribeFontAvailability,
    getFontAvailabilityVersion,
    getFontAvailabilityVersion,
  );

  const fontSize = node.fontSize ?? 14;
  const lineHeightRatio = node.lineHeight ?? 1.2;
  const rawFont = node.fontFamily?.trim();
  const fontFamily = buildFontStack(rawFont);
  const fontWeight = node.fontWeight ?? 'normal';
  const fill = resolveFill(node.fill, ctx);
  const resolvedFill = fill === 'none' ? '#111827' : fill;
  const filterVal = resolveFilter(ctx);
  const letterSpacing = node.letterSpacing ?? 0;
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  // Exact Figma glyph outlines: when .fig provided pre-shaped HarfBuzz glyph paths,
  // render them directly for 1-to-1 fidelity across custom/missing fonts and SVG exports
  // (cleared automatically in nodeOps.ts if the user edits text content).
  const useGlyphFallback =
    Array.isArray(node.glyphOutlines) &&
    node.glyphOutlines.length > 0 &&
    (node.glyphOutlines.length > 0 || !isFontFamilyAvailable(rawFont));

  if (useGlyphFallback && node.glyphOutlines) {
    const translate = x === 0 && y === 0 ? undefined : `translate(${x} ${y})`;
    return (
      <g transform={translate} filter={filterVal}>
        {node.glyphOutlines.map((run, idx) => (
          <path key={idx} d={run.d} fill={run.fill ?? resolvedFill} />
        ))}
      </g>
    );
  }

  const lines = normalizeTextLines(node.content);
  const hasSpans = Array.isArray(node.spans) && node.spans.length > 0;

  const isFixedWidth =
    node.textGrowth === 'fixed-width' || node.textGrowth === 'fixed-width-height';
  const widthForAlign = typeof node.width === 'number' ? node.width : 0;

  let renderX = x;
  let textAnchor: 'start' | 'middle' | 'end' = 'start';
  if (isFixedWidth && widthForAlign > 0) {
    switch (node.textAlign) {
      case 'center':
        renderX = x + widthForAlign / 2;
        textAnchor = 'middle';
        break;
      case 'right':
        renderX = x + widthForAlign;
        textAnchor = 'end';
        break;
      default:
        renderX = x;
        textAnchor = 'start';
        break;
    }
  }

  const baseDecoration =
    [node.underline ? 'underline' : '', node.strikethrough ? 'line-through' : '']
      .filter(Boolean)
      .join(' ') || undefined;

  if (isFixedWidth && widthForAlign > 0) {
    const resolvedHeight =
      typeof node.height === 'number' && node.height > 0 ? node.height : undefined;
    const fallbackHeight = Math.max(fontSize * lineHeightRatio * lines.length * 5, 200);
    const hasFixedHeight = node.textGrowth === 'fixed-width-height' && resolvedHeight != null;
    const vAlign = hasFixedHeight ? node.textAlignVertical ?? 'top' : 'top';
    const flexAlign = vAlign === 'middle' ? 'center' : vAlign === 'bottom' ? 'flex-end' : 'flex-start';

    return (
      <foreignObject
        x={x}
        y={y}
        width={widthForAlign}
        height={resolvedHeight ?? fallbackHeight}
        overflow="visible"
        filter={filterVal}
      >
        <div
          // @ts-expect-error xmlns is valid for foreignObject children
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: flexAlign,
            margin: 0,
            padding: 0,
          }}
        >
          <div
            style={{
              fontSize: `${fontSize}px`,
              fontFamily,
              fontWeight,
              color: resolvedFill,
              lineHeight: lineHeightRatio,
              textAlign: node.textAlign ?? 'left',
              letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'visible',
              margin: 0,
              padding: 0,
              textDecoration: baseDecoration,
              fontStyle: node.fontStyle ?? undefined,
            }}
          >
            {hasSpans
              ? node.spans!.map((sp, idx) => {
                  const spDec =
                    [sp.underline ? 'underline' : '', sp.strikethrough ? 'line-through' : '']
                      .filter(Boolean)
                      .join(' ') || undefined;
                  return (
                    <span
                      key={idx}
                      style={{
                        color: sp.fill ?? undefined,
                        fontFamily: sp.fontFamily ? buildFontStack(sp.fontFamily) : undefined,
                        fontWeight: sp.fontWeight ?? undefined,
                        fontStyle: sp.fontStyle ?? undefined,
                        fontSize: sp.fontSize ? `${sp.fontSize}px` : undefined,
                        letterSpacing:
                          sp.letterSpacing !== undefined ? `${sp.letterSpacing}px` : undefined,
                        textDecoration: spDec,
                      }}
                    >
                      {applyTextCase(sp.text, sp.textCase ?? node.textCase)}
                    </span>
                  );
                })
              : applyTextCase(node.content, node.textCase) ?? ''}
          </div>
        </div>
      </foreignObject>
    );
  }

  const spanLines = hasSpans ? splitSpansByNewline(node.spans!) : null;

  return (
    <text
      x={renderX}
      y={y}
      fill={resolvedFill}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
      dominantBaseline="text-before-edge"
      textAnchor={textAnchor}
      letterSpacing={letterSpacing || undefined}
      filter={filterVal}
      style={{
        whiteSpace: 'pre',
        textDecoration: baseDecoration,
        fontStyle: node.fontStyle ?? undefined,
      }}
    >
      {spanLines
        ? spanLines.map((lineSpans, lineIdx) => {
            const extra =
              lineIdx > 0 && (spanLines[lineIdx - 1].length === 0 || lineSpans.length === 0)
                ? (node.paragraphSpacing ?? 0)
                : 0;
            const dy = lineIdx === 0 ? 0 : fontSize * lineHeightRatio + extra;
            if (lineSpans.length === 0) {
              return (
                <tspan key={lineIdx} x={renderX} dy={dy}>
                  {' '}
                </tspan>
              );
            }
            return lineSpans.map((sp, spIdx) => (
              <tspan
                key={`${lineIdx}-${spIdx}`}
                x={spIdx === 0 ? renderX : undefined}
                dy={spIdx === 0 ? dy : undefined}
                fill={sp.fill ?? undefined}
                fontFamily={sp.fontFamily ? buildFontStack(sp.fontFamily) : undefined}
                fontWeight={sp.fontWeight ?? undefined}
                fontStyle={sp.fontStyle ?? undefined}
                fontSize={sp.fontSize ?? undefined}
              >
                {applyTextCase(sp.text, sp.textCase ?? node.textCase)}
              </tspan>
            ));
          })
        : lines.map((line, i) => {
            const extra =
              i > 0 && (lines[i - 1] === '' || line === '')
                ? (node.paragraphSpacing ?? 0)
                : 0;
            return (
              <tspan key={i} x={renderX} dy={i === 0 ? 0 : fontSize * lineHeightRatio + extra}>
                {applyTextCase(line || ' ', node.textCase)}
              </tspan>
            );
          })}
    </text>
  );
}
