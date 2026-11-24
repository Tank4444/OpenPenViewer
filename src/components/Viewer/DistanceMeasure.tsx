/**
 * Figma-like distance measurement:
 * When a node is selected and Alt/Option is held while hovering another node
 * (including nested children or parent frames/screens), renders red distance
 * lines with extension guides and numeric labels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../pen/state/EditorContext';
import {
  collectWorldRects,
  computeMeasurements,
  findHitNodeId,
  type WorldRect,
} from './distanceMeasureMath';

interface SvgCtm {
  a: number;
  d: number;
  e: number;
  f: number;
}

interface MeasureSnapshot {
  selected: WorldRect;
  hovered: WorldRect;
  screenScale: number;
}

function getSvgCtm(svg: SVGSVGElement | null): SvgCtm | null {
  if (!svg || typeof svg.getScreenCTM !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm || ctm.a === 0 || ctm.d === 0) return null;
  return { a: ctm.a, d: ctm.d, e: ctm.e, f: ctm.f };
}

function screenToSvg(ctm: SvgCtm, clientX: number, clientY: number): { x: number; y: number } {
  return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d };
}

function rectFromElement(ctm: SvgCtm, el: Element, nodeId: string): WorldRect | null {
  const boundsEl = el.parentElement?.querySelector(':scope > [data-node-bounds]') ?? el;
  if (typeof boundsEl.getBoundingClientRect !== 'function') return null;
  const box = boundsEl.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const topLeft = screenToSvg(ctm, box.left, box.top);
  const bottomRight = screenToSvg(ctm, box.right, box.bottom);
  return {
    id: nodeId,
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
    depth: 0,
  };
}

function findClosestDomNodeRect(
  svg: SVGSVGElement,
  ctm: SvgCtm,
  nodeId: string,
  refClientX: number,
  refClientY: number,
): WorldRect | null {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(nodeId)
      : nodeId.replace(/"/g, '\\"');
  const matches = svg.querySelectorAll(`[data-node-id="${escaped}"]`);
  let bestRect: WorldRect | null = null;
  let bestDist = Infinity;

  for (const el of matches) {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dist = Math.hypot(cx - refClientX, cy - refClientY);
    if (dist < bestDist) {
      const candidate = rectFromElement(ctm, el, nodeId);
      if (candidate) {
        bestDist = dist;
        bestRect = candidate;
      }
    }
  }
  return bestRect;
}

function findDomHitNode(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  excludeId: string | null,
): { id: string; el: Element } | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    if (!svg.contains(el)) continue;
    const nodeEl = el.closest('[data-node-id]');
    if (!nodeEl || !svg.contains(nodeEl)) continue;
    const id = nodeEl.getAttribute('data-node-id');
    if (id && id !== excludeId) {
      return { id, el: nodeEl };
    }
  }
  return null;
}

interface Props {
  svgRef: React.RefObject<SVGSVGElement | null>;
  svgScale: number;
}

export function DistanceMeasure({ svgRef, svgScale }: Props) {
  const { state } = useEditor();
  const [altDown, setAltDown] = useState(false);
  const [snapshot, setSnapshot] = useState<MeasureSnapshot | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const worldRects = useMemo(() => collectWorldRects(state.doc.children), [state.doc.children]);

  const updateMeasureAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const selectedId = state.selectedNodeId;
      if (!svg || !selectedId) {
        setSnapshot(null);
        return;
      }

      const ctm = getSvgCtm(svg);
      const domHit = findDomHitNode(svg, clientX, clientY, selectedId);

      if (domHit && ctm) {
        const hovered = rectFromElement(ctm, domHit.el, domHit.id);
        const hBox = domHit.el.getBoundingClientRect();
        const refX = hBox.width > 0 ? hBox.left + hBox.width / 2 : clientX;
        const refY = hBox.height > 0 ? hBox.top + hBox.height / 2 : clientY;
        const selected =
          findClosestDomNodeRect(svg, ctm, selectedId, refX, refY) ??
          worldRects.find((r) => r.id === selectedId) ??
          null;

        if (selected && hovered) {
          setSnapshot({
            selected,
            hovered,
            screenScale: Math.max(ctm.a, 0.001),
          });
          return;
        }
      }

      // Fallback when DOM geometry is unavailable (e.g. unit tests)
      const hoverId = ctm
        ? findHitNodeId(worldRects, screenToSvg(ctm, clientX, clientY), selectedId)
        : null;
      if (!hoverId || hoverId === selectedId) {
        setSnapshot(null);
        return;
      }
      const selected = worldRects.find((r) => r.id === selectedId) ?? null;
      const hovered = worldRects.find((r) => r.id === hoverId) ?? null;
      if (!selected || !hovered) {
        setSnapshot(null);
        return;
      }

      setSnapshot({
        selected,
        hovered,
        screenScale: Math.max(ctm ? ctm.a : svgScale, 0.001),
      });
    },
    [svgRef, worldRects, state.selectedNodeId, svgScale],
  );

  // Track pointer globally with rAF throttling so Alt-hover doesn't cause layout thrashing
  useEffect(() => {
    let rafId = 0;
    const handlePointerMove = (e: PointerEvent) => {
      const cx = e.clientX;
      const cy = e.clientY;
      lastPointerRef.current = { x: cx, y: cy };
      if (!e.altKey || !state.selectedNodeId) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateMeasureAtClientPoint(cx, cy);
      });
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [state.selectedNodeId, updateMeasureAtClientPoint]);

  // Track Alt key state
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.altKey) {
        setAltDown(true);
        if (lastPointerRef.current && state.selectedNodeId) {
          updateMeasureAtClientPoint(lastPointerRef.current.x, lastPointerRef.current.y);
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
  }, [state.selectedNodeId, updateMeasureAtClientPoint]);

  const measuring = altDown && !!state.selectedNodeId;
  if (!measuring || !snapshot || snapshot.selected.id !== state.selectedNodeId) {
    return null;
  }

  const { selected, hovered, screenScale } = snapshot;
  const { lines, labels } = computeMeasurements(selected, hovered);
  const stroke = '#DC2626';
  const strokeWidth = 1.5 / screenScale;
  const labelFont = 12 / screenScale;
  const labelPadX = 5 / screenScale;
  const labelPadY = 2.5 / screenScale;

  return (
    <g pointerEvents="none" data-testid="distance-measure">
      {/* Highlight hovered node */}
      <rect
        x={hovered.x - 1 / screenScale}
        y={hovered.y - 1 / screenScale}
        width={hovered.width + 2 / screenScale}
        height={hovered.height + 2 / screenScale}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={`${4 / screenScale} ${3 / screenScale}`}
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
          strokeDasharray={l.dashed ? `${3 / screenScale} ${2 / screenScale}` : undefined}
        />
      ))}
      {labels.map((l) => {
        const textWidth = l.text.length * labelFont * 0.65 + labelPadX * 2;
        const boxHeight = labelFont + labelPadY * 2;
        return (
          <g key={l.key}>
            <rect
              x={l.x - textWidth / 2}
              y={l.y - boxHeight / 2}
              width={textWidth}
              height={boxHeight}
              rx={3 / screenScale}
              fill={stroke}
            />
            <text
              x={l.x}
              y={l.y + labelFont * 0.35}
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
