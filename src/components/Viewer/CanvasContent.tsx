/**
 * SVG 内のコンテンツ描画。EditorContext の rawDoc を使い、
 * トップレベル単位の WeakMap キャッシュで変更のあった画面だけ再レイアウトする。
 * 背景クリックでノード選択解除。
 */

import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { getTextMetricsVersion, subscribeTextMetrics } from '../../pen/layout/textMeasure';
import { IncrementalLayoutCache } from '../../pen/layout/incrementalLayout';
import { useEditorActions, useEditorSelector, useEditorStore } from '../../pen/state/EditorContext';
import { buildPaintRegistry } from '../../pen/paint/registry';
import { Defs } from '../../pen/paint/Defs';
import { PaintRegistryProvider } from '../../pen/paint/PaintContext';
import { renderMaskedChildren } from '../../pen/renderer/MaskedChildren';
import type { ViewBox } from '../../pen/renderer/viewBox';
import { filterVisibleTopLevelNodes } from './viewportCulling';

interface CanvasContentProps {
  cullViewBox?: ViewBox;
}

export const CanvasContent = memo(function CanvasContent({ cullViewBox }: CanvasContentProps) {
  const store = useEditorStore();
  const { selectNode } = useEditorActions();
  const rawDoc = useEditorSelector((s) => s.rawDoc);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const textMetricsVersion = useSyncExternalStore(
    subscribeTextMetrics,
    getTextMetricsVersion,
    getTextMetricsVersion,
  );

  // Pre-seed per-screen WeakMap layout cache with the pre-computed doc from useDocument
  const [layoutCache] = useState(() => {
    const cache = new IncrementalLayoutCache();
    const initState = store.getState();
    cache.seed(initState.rawDoc, initState.doc, getTextMetricsVersion());
    return cache;
  });

  const doc = useMemo(
    () => layoutCache.compute(rawDoc, textMetricsVersion),
    [layoutCache, rawDoc, textMetricsVersion],
  );

  const visibleChildren = useMemo(
    () => filterVisibleTopLevelNodes(doc.children, cullViewBox, selectedNodeId),
    [doc.children, cullViewBox, selectedNodeId],
  );

  // Build <Defs> only for currently visible nodes so off-screen filters/gradients stay out of DOM
  const registry = useMemo(
    () => buildPaintRegistry({ ...doc, children: visibleChildren }),
    [doc, visibleChildren],
  );

  return (
    <>
      {/* Background hit area: click to deselect */}
      <rect
        x={-1e6}
        y={-1e6}
        width={2e6}
        height={2e6}
        fill={doc.background ?? 'transparent'}
        onClick={() => {
          if (store.getState().activeTool === 'select') selectNode(null);
        }}
      />
      <Defs registry={registry} />
      <PaintRegistryProvider value={registry}>
        {renderMaskedChildren(visibleChildren)}
      </PaintRegistryProvider>
    </>
  );
});
