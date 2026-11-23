/**
 * Figma-like distance measurement:
 * When a node is selected and Alt/Option is held while hovering another node
 * (including nested children or parent frames/screens), renders red distance
 * lines with extension guides and numeric labels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../pen/state/EditorContext';
import { collectWorldRects, computeMeasurements, findHitNodeId } from './distanceMeasureMath';

function screenToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm || ctm.a === 0 || ctm.d === 0) return { x: 0, y: 0 };
  return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d };
}

interface Props {
  svgRef: React.RefObject<SVGSVGElement | null>;
  svgScale: number;
}

export function DistanceMeasure({ svgRef, svgScale }: Props) {
  const { state } = useEditor();
  const [altDown, setAltDown] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const worldRects = useMemo(() => collectWorldRects(state.doc.children), [state.doc.children]);

  const updateHoverAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const pt = screenToSvg(svg, clientX, clientY);
      setHoverId(findHitNodeId(worldRects, pt, state.selectedNodeId));
    },
    [svgRef, worldRects, state.selectedNodeId],
  );

  // Track pointer globally so pressing Alt without moving the mouse still measures immediately
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (e.altKey && state.selectedNodeId) {
        updateHoverAtClientPoint(e.clientX, e.clientY);
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [state.selectedNodeId, updateHoverAtClientPoint]);

  // Track Alt key state
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.altKey) {
        setAltDown(true);
        if (lastPointerRef.current && state.selectedNodeId) {
          updateHoverAtClientPoint(lastPointerRef.current.x, lastPointerRef.current.y);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!e.altKey) setAltDown(false);
    };
    const blur = () => setAltDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [state.selectedNodeId, updateHoverAtClientPoint]);

  const measuring = altDown && !!state.selectedNodeId;
  const activeHoverId = measuring ? hoverId : null;

  const selected = useMemo(
    () => (state.selectedNodeId ? worldRects.find((r) => r.id === state.selectedNodeId) ?? null : null),
    [state.selectedNodeId, worldRects],
  );

  const hovered = useMemo(
    () => (activeHoverId ? worldRects.find((r) => r.id === activeHoverId) ?? null : null),
    [activeHoverId, worldRects],
  );

  if (!measuring || !selected || !hovered || selected.id === hovered.id) return null;

  const { lines, labels } = computeMeasurements(selected, hovered);
  const stroke = '#DC2626';
  const safeScale = Math.max(svgScale, 0.001);
  const strokeWidth = 1 / safeScale;
  const labelFont = 11 / safeScale;
  const labelPad = 3 / safeScale;

  return (
    <g pointerEvents="none" data-testid="distance-measure">
      {/* Highlight hovered node */}
      <rect
        x={hovered.x - 1 / safeScale}
        y={hovered.y - 1 / safeScale}
        width={hovered.width + 2 / safeScale}
        height={hovered.height + 2 / safeScale}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={`${4 / safeScale} ${3 / safeScale}`}
      />
      {lines.map((l) => (
        <line
          key={l.key}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={l.dashed ? `${3 / safeScale} ${2 / safeScale}` : undefined}
        />
      ))}
      {labels.map((l) => {
        const textWidth = l.text.length * labelFont * 0.65 + labelPad * 2;
        return (
          <g key={l.key}>
            <rect
              x={l.x - textWidth / 2}
              y={l.y - labelFont * 0.7}
              width={textWidth}
              height={labelFont * 1.3}
              rx={labelFont * 0.25}
              fill={stroke}
            />
            <text
              x={l.x}
              y={l.y + labelFont * 0.3}
              fontSize={labelFont}
              fontFamily="system-ui, sans-serif"
              fontWeight={600}
              fill="#FFFFFF"
              textAnchor="middle"
            >
              {l.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
