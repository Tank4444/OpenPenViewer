/**
 * SVG 内のコンテンツ描画。EditorContext の rawDoc を使い、毎レンダリングで
 * ref 展開 / 変数置換 / flex レイアウトを再計算してリアルタイム反映する。
 * 背景クリックでノード選択解除。
 */

import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { getTextMetricsVersion, subscribeTextMetrics } from '../../pen/layout/textMeasure';
import { useEditorActions, useEditorSelector, useEditorStore } from '../../pen/state/EditorContext';
import { buildPaintRegistry } from '../../pen/paint/registry';
import { Defs } from '../../pen/paint/Defs';
import { PaintRegistryProvider } from '../../pen/paint/PaintContext';
import { resolveRefs } from '../../pen/refs';
import { substituteVariables } from '../../pen/variables';
import { renderMaskedChildren } from '../../pen/renderer/MaskedChildren';
import { layoutDocument } from '../../pen/layout';
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

  // Reuse pre-computed doc from useDocument on initial mount to avoid double layout work
  const [initialSnapshot] = useState(() => ({
    rawDoc,
    doc: store.getState().doc,
    textVersion: textMetricsVersion,
  }));

  const doc = useMemo(() => {
    if (rawDoc === initialSnapshot.rawDoc && textMetricsVersion === initialSnapshot.textVersion) {
      return initialSnapshot.doc;
    }
    return layoutDocument(substituteVariables(resolveRefs(rawDoc)));
  }, [rawDoc, textMetricsVersion, initialSnapshot]);

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
        fill="transparent"
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
