import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PenDocument, PenNode } from '../../pen/types';
import { computeViewBox } from '../../pen/renderer/viewBox';
import { CanvasContent } from './CanvasContent';
import { usePanZoom } from './usePanZoom';
import { collectFrames } from './frames';
import { useFrameNavigation } from './useFrameNavigation';
import { usePresentMode } from './usePresentMode';
import { useViewerShortcuts } from './useViewerShortcuts';
import { ShortcutsDialog } from './ShortcutsDialog';
import { FrameSearch } from './FrameSearch';
import { EditorProvider, useEditor as useEditorInternal } from '../../pen/state/EditorContext';
import { PropertyPanel } from './PropertyPanel';
import { GitHubDirtyTracker } from '../../github/GitHubDirtyTracker';
import { AutoIdDialog } from './AutoIdDialog';
import { type Command } from './CommandPalette';
import { CommandPaletteWrapper } from './CommandPaletteWrapper';
import { VimTextObjects } from './VimTextObjects';
import { ZoomToSelected } from './ZoomToSelected';
import { HintLabels } from './HintLabels';
import { NudgeHandler } from './NudgeHandler';
import { MarqueeSelect } from './MarqueeSelect';
import { EditAnimation } from './EditAnimation';
const UIStatesPanel = lazy(() => import('./UIStatesPanel').then((m) => ({ default: m.UIStatesPanel })));
import { useCollab } from '../../collab/useCollab';
import { CollabSync } from '../../collab/CollabSync';
import { useBridge } from '../../collab/useBridge';
import { BridgeSync } from '../../collab/BridgeSync';
import { RemoteCursors } from '../../collab/RemoteCursors';
import { ContextMenu } from './ContextMenu';
const AIReviewPanel = lazy(() => import('./AIReviewPanel').then((m) => ({ default: m.AIReviewPanel })));
import { isAIReviewEnabled } from '../../utils/aiReview';
const AIGeneratorPanel = lazy(() => import('./AIGeneratorPanel').then((m) => ({ default: m.AIGeneratorPanel })));
import { isAIGenerateEnabled } from '../../utils/aiGenerate';
import { FloatingTextToolbar } from './FloatingTextToolbar';
import { ImageDropHandler } from './ImageDropHandler';
const FindReplaceDialog = lazy(() => import('./FindReplaceDialog').then((m) => ({ default: m.FindReplaceDialog })));
import { VariablesPanel } from './VariablesPanel';
const DevInspectPanel = lazy(() => import('./DevInspectPanel').then((m) => ({ default: m.DevInspectPanel })));
import { StylesPanel } from './StylesPanel';
import { SelectionColorsPanel } from './SelectionColorsPanel';
import { ShapeCreator } from './ShapeCreator';
import { PenToolCreator } from './PenToolCreator';
import { PathEditor } from './PathEditor';
import { CommentsLayer } from './CommentsLayer';
import { SmartAnimateOverlay } from './SmartAnimateOverlay';
import { ToolShortcuts } from './ToolShortcuts';
import { SnapGuides } from './SnapGuides';
import { DistanceMeasure } from './DistanceMeasure';
import { Rulers } from './Rulers';
import { EditorToolbar } from './EditorToolbar';
import { LeftSidebar } from './LeftSidebar';

export type { FrameEntry } from './frames';

function VimBadge() {
  const { state } = useEditorInternal();
  return (
    <div className={`viewer__vim-badge ${state.insertMode ? 'viewer__vim-badge--insert' : ''}`}>
      {state.insertMode ? '-- INSERT --' : '-- NORMAL --'}
    </div>
  );
}

export interface PenViewerProps {
  doc: PenDocument;
  rawDoc?: PenDocument;
  fileName?: string;
  savedToast?: string | null;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onOpenLocal?: () => void;
  onBack?: () => void;
}

export function PenViewer({
  doc,
  rawDoc,
  fileName,
  savedToast,
  theme = 'dark',
  onToggleTheme,
  onOpenLocal,
  onBack,
}: PenViewerProps) {
  // doc が変わったときだけ計算し直す。毎レンダーで新しいオブジェクトを作ると
  // これを deps に持つ useCallback/useEffect が毎回作り直しになる。
  const baseVb = useMemo(() => computeViewBox(doc), [doc]);
  const frames = useMemo(() => collectFrames(doc.children), [doc]);

  const svgRef = useRef<SVGSVGElement>(null);

  // カメラ（パン / ズーム / フィット）は usePanZoom に切り出してある (#71)
  const {
    containerRef,
    camera,
    setCamera,
    clientSize,
    viewBox: currentVb,
    scale,
    zoomPercent,
    clampSvgWidth,
    zoomToRect,
    fitToDocument,
    zoomByFactor,
    zoomTo100,
    isPanning,
    isSpaceHeld,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = usePanZoom(doc, baseVb, svgRef);

  // フレーム単位のナビゲーション (ハイライト / 履歴 / Vim 移動) (#71)
  const {
    activeFrameId,
    setActiveFrameId,
    canGoBack,
    canGoForward,
    navigateBack,
    navigateForward,
    zoomToFrame,
    resetView,
    navigateVim,
  } = useFrameNavigation({ frames, camera, setCamera, zoomToRect, fitToDocument });

  // Present モード + Smart Animate (#71)
  const { presentMode, setPresentMode, transition } = usePresentMode({
    docChildren: doc.children,
    frames,
    svgRef,
    zoomToRect,
    setActiveFrameId,
  });

  // P2P Collab
  const {
    collab,
    createRoom,
    joinRoom,
    disconnect,
    getRoomUrl,
    setUserName,
    setSelfColor,
    setSignalingUrl,
    syncDoc: syncCollabDoc,
    setRemoteHandler,
    setLocalCursor,
    setLocalSelection,
  } = useCollab();
  const {
    bridge,
    connectBridge,
    disconnectBridge,
    syncBridgeDoc,
    setBridgeUrl,
    setBridgeRemoteHandler,
  } = useBridge();

  /** 招待リンク (?code= または ?room=) 経由で開いたか。マウント時に一度だけ判定する */
  const [joinedViaUrl] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.has('code') || p.has('room');
  });

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFrameSearch, setShowFrameSearch] = useState(false);
  const [showAutoId, setShowAutoId] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showUIStates, setShowUIStates] = useState(false);
  const [showAIReview, setShowAIReview] = useState(false);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [vimMode, setVimMode] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [showRulers, setShowRulers] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showDevInspect, setShowDevInspect] = useState(false);
  const [showStyles, setShowStyles] = useState(false);
  const [showSelectionColors, setShowSelectionColors] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Collab: 招待リンク (?code= / ?room=) で開いた場合は自動で入室
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const room = p.get('code') ?? p.get('room');
    if (room) joinRoom(room, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collab: 接続中はポインタ移動を SVG 座標に変換して自分のカーソルを配信
  useEffect(() => {
    if (!collab.connected) return;
    const el = containerRef.current;
    if (!el) return;
    let last = 0;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!ctm) return;
      setLocalCursor({ x: (e.clientX - ctm.e) / ctm.a, y: (e.clientY - ctm.f) / ctm.d });
    };
    const onLeave = () => setLocalCursor(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [collab.connected, setLocalCursor, containerRef]);

  // Keyboard shortcuts (#71)
  useViewerShortcuts({
    vimMode,
    containerRef,
    setCamera,
    setActiveFrameId,
    navigateBack,
    navigateForward,
    navigateVim,
    resetView,
    zoomTo100,
    zoomByFactor,
    setShowCommandPalette,
    setShowFrameSearch,
    setShowAutoId,
    setShowShortcuts,
    setShowRulers,
    setShowFindReplace,
    setShowAIGenerate,
    setShowDevInspect,
    setPresentMode,
    setFocusMode,
  });

  const cursor = isSpaceHeld.current || isPanning.current ? 'grab' : 'default';

  // Quantize viewBox with power-of-2 step so CanvasContent (React.memo) stays stable across pan & zoom frames
  const cullStep = 2 ** Math.floor(Math.log2(Math.max(128, currentVb.width * 0.5)));
  const qx = Math.floor(currentVb.x / cullStep) * cullStep;
  const qy = Math.floor(currentVb.y / cullStep) * cullStep;
  const qw = Math.ceil((currentVb.width + cullStep) / cullStep) * cullStep;
  const qh = Math.ceil((currentVb.height + cullStep) / cullStep) * cullStep;
  const cullViewBox = useMemo(
    () => ({ x: qx, y: qy, width: qw, height: qh }),
    [qx, qy, qw, qh],
  );

  const toggleLeftSidebar = useCallback(() => setShowLeftSidebar((v) => !v), []);
  const toggleProperties = useCallback(() => setShowProperties((v) => !v), []);
  const handleZoomOut = useCallback(() => zoomByFactor(1 / 1.25), [zoomByFactor]);
  const handleZoomIn = useCallback(() => zoomByFactor(1.25), [zoomByFactor]);
  const handleZoomChange = useCallback(
    (percent: number) => {
      const newScale = percent / 100;
      setCamera((prev) => ({
        ...prev,
        svgWidth: clampSvgWidth(baseVb.width / newScale),
      }));
    },
    [baseVb.width, clampSvgWidth, setCamera],
  );
  const handleOpenAIGenerate = useCallback(() => setShowAIGenerate(true), []);
  const handleOpenShortcuts = useCallback(() => setShowShortcuts(true), []);
  const handleStartCollab = useCallback(() => {
    createRoom(rawDoc ?? doc);
  }, [createRoom, rawDoc, doc]);
  const handleJoinRoom = useCallback(
    (roomId: string) => {
      joinRoom(roomId, null);
    },
    [joinRoom],
  );
  const handleConnectBridge = useCallback(
    (url: string) => {
      connectBridge(url, rawDoc ?? doc);
    },
    [connectBridge, rawDoc, doc],
  );

  return (
    <EditorProvider doc={doc} rawDoc={rawDoc}>
      <GitHubDirtyTracker />
      {(collab.connected || joinedViaUrl) && (
        <CollabSync
          connected={collab.connected}
          joining={joinedViaUrl}
          syncDoc={syncCollabDoc}
          setRemoteHandler={setRemoteHandler}
          setLocalSelection={setLocalSelection}
        />
      )}
      {bridge.connected && (
        <BridgeSync
          connected={bridge.connected}
          syncDoc={syncBridgeDoc}
          setRemoteHandler={setBridgeRemoteHandler}
        />
      )}
      <div className={`viewer${presentMode ? ' viewer--present' : ''}${focusMode ? ' viewer--focus' : ''}`}>
        <EditorToolbar
          fileName={fileName}
          savedToast={savedToast}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onOpenLocal={onOpenLocal}
          onBack={onBack}
          zoomPercent={zoomPercent}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomChange={handleZoomChange}
          onResetView={resetView}
          frames={frames}
          activeFrameId={activeFrameId}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onNavigateBack={navigateBack}
          onNavigateForward={navigateForward}
          onSelectFrame={zoomToFrame}
          onOpenAIGenerate={handleOpenAIGenerate}
          onOpenShortcuts={handleOpenShortcuts}
          collab={collab}
          onStartCollab={handleStartCollab}
          onJoinRoom={handleJoinRoom}
          onDisconnectCollab={disconnect}
          onChangeCollabName={setUserName}
          onChangeCollabColor={setSelfColor}
          onChangeCollabSignaling={setSignalingUrl}
          roomUrl={getRoomUrl()}
          bridge={bridge}
          onConnectBridge={handleConnectBridge}
          onDisconnectBridge={disconnectBridge}
          onChangeBridgeUrl={setBridgeUrl}
        />
        <div className="viewer__body viewer__body--unified">
          <div className={`viewer__canvas-wrap${showRulers ? ' viewer__canvas-wrap--rulers' : ''}`}>
            {showRulers && <Rulers viewBox={currentVb} clientSize={clientSize} show={showRulers} />}
            <div
              ref={containerRef}
              className="viewer__canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ cursor }}
            >
              <svg
                ref={svgRef}
                className="viewer__svg"
                viewBox={`${currentVb.x} ${currentVb.y} ${currentVb.width} ${currentVb.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                <CanvasContent cullViewBox={cullViewBox} />
                {collab.connected && <RemoteCursors peers={collab.peers} scale={scale} />}
                {activeFrameId &&
                  frames.map((f) =>
                    f.id === activeFrameId ? (
                      <rect
                        key={`highlight-${f.id}`}
                        x={f.x}
                        y={f.y}
                        width={f.width}
                        height={f.height}
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth={2 / scale}
                        strokeDasharray={`${6 / scale} ${4 / scale}`}
                        rx={4 / scale}
                        pointerEvents="none"
                      />
                    ) : null,
                  )}
                <HintLabels
                  vimMode={vimMode}
                  svgScale={scale}
                  cameraCx={camera.cx}
                  cameraCy={camera.cy}
                  viewBox={currentVb}
                />
                <MarqueeSelect viewBox={currentVb} svgRef={svgRef} />
                <ShapeCreator svgRef={svgRef} />
                <PenToolCreator svgRef={svgRef} svgScale={scale} />
                <PathEditor svgRef={svgRef} svgScale={scale} />
                <CommentsLayer svgRef={svgRef} svgScale={scale} />
                <SnapGuides svgScale={scale} />
                <DistanceMeasure svgRef={svgRef} svgScale={scale} />
                <EditAnimation />
                {transition &&
                  frames[transition.fromIdx] &&
                  frames[transition.toIdx] &&
                  (() => {
                    // Smart Animate オーバーレイ: 元フレームを探して補間描画
                    const fromFrameId = frames[transition.fromIdx].id;
                    const toFrameId = frames[transition.toIdx].id;
                    const findFrame = (nodes: PenNode[], id: string): PenNode | null => {
                      for (const n of nodes) {
                        if (n.id === id) return n;
                      }
                      return null;
                    };
                    const f = findFrame(doc.children, fromFrameId);
                    const t = findFrame(doc.children, toFrameId);
                    if (f?.type !== 'frame' || t?.type !== 'frame') return null;
                    return (
                      <g style={{ mixBlendMode: 'normal' }}>
                        {/* 裏の元フレーム / 遷移先フレームを隠すため、黒背景の rect をフレーム位置に置く */}
                        <SmartAnimateOverlay
                          fromFrame={f}
                          toFrame={t}
                          progress={transition.progress}
                          easing={transition.easing}
                          smartAnimate={transition.smartAnimate}
                        />
                      </g>
                    );
                  })()}
              </svg>
            </div>
          </div>
          <LeftSidebar
            open={showLeftSidebar}
            onToggle={toggleLeftSidebar}
            onZoomToPage={zoomToFrame}
            onZoomToNode={zoomToRect}
          />
          <PropertyPanel collapsed={!showProperties} onTogglePanel={toggleProperties} />
        </div>

        {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
        {showFrameSearch && (
          <FrameSearch
            frames={frames}
            activeFrameId={activeFrameId}
            cameraCx={camera.cx}
            cameraCy={camera.cy}
            onSelect={zoomToFrame}
            onClose={() => setShowFrameSearch(false)}
          />
        )}
        {showAutoId && <AutoIdDialog onClose={() => setShowAutoId(false)} />}
        {showUIStates && (
          <Suspense fallback={null}>
            <UIStatesPanel onClose={() => setShowUIStates(false)} locale="ja" />
          </Suspense>
        )}
        {showAIReview && (
          <Suspense fallback={null}>
            <AIReviewPanel onClose={() => setShowAIReview(false)} locale="ja" />
          </Suspense>
        )}
        {showAIGenerate && (
          <Suspense fallback={null}>
            <AIGeneratorPanel onClose={() => setShowAIGenerate(false)} onZoomToNode={(r) => zoomToRect(r)} />
          </Suspense>
        )}
        {showFindReplace && (
          <Suspense fallback={null}>
            <FindReplaceDialog onClose={() => setShowFindReplace(false)} onFocusNode={(r) => zoomToRect(r)} />
          </Suspense>
        )}
        {showVariables && <VariablesPanel onClose={() => setShowVariables(false)} />}
        {showDevInspect && (
          <Suspense fallback={null}>
            <DevInspectPanel onClose={() => setShowDevInspect(false)} />
          </Suspense>
        )}
        {showStyles && <StylesPanel onClose={() => setShowStyles(false)} />}
        {showSelectionColors && <SelectionColorsPanel onClose={() => setShowSelectionColors(false)} />}
        {showCommandPalette && (
          <CommandPaletteWrapper
            baseCommands={
              [
                {
                  id: 'vim-toggle',
                  label: `Vim Mode: ${vimMode ? 'ON → OFF' : 'OFF → ON'}`,
                  action: () => setVimMode((v) => !v),
                },
                {
                  id: 'frame-search',
                  label: 'Search Frames',
                  shortcut: 'Cmd+P',
                  action: () => setShowFrameSearch(true),
                },
                {
                  id: 'auto-id',
                  label: 'Auto ID / Rename Frames',
                  shortcut: 'Cmd+I',
                  action: () => setShowAutoId(true),
                },
                { id: 'ui-states', label: 'Five UI States Audit', action: () => setShowUIStates(true) },
                {
                  id: 'variables',
                  label: '🎨 Variables (Design Tokens)',
                  action: () => setShowVariables(true),
                },
                {
                  id: 'dev-inspect',
                  label: '🧑‍💻 Dev Mode / Inspect',
                  shortcut: 'Cmd+Shift+D',
                  action: () => setShowDevInspect(true),
                },
                {
                  id: 'styles',
                  label: '💠 Styles (Color / Text / Effect)',
                  action: () => setShowStyles(true),
                },
                {
                  id: 'selection-colors',
                  label: '🎨 Selection / Document Colors',
                  action: () => setShowSelectionColors(true),
                },
                {
                  id: 'bool-union',
                  label: 'Boolean: Union',
                  action: () => window.dispatchEvent(new CustomEvent('pencil-bool-op', { detail: 'union' })),
                },
                {
                  id: 'bool-subtract',
                  label: 'Boolean: Subtract',
                  action: () =>
                    window.dispatchEvent(new CustomEvent('pencil-bool-op', { detail: 'subtract' })),
                },
                {
                  id: 'bool-intersect',
                  label: 'Boolean: Intersect',
                  action: () =>
                    window.dispatchEvent(new CustomEvent('pencil-bool-op', { detail: 'intersect' })),
                },
                {
                  id: 'bool-exclude',
                  label: 'Boolean: Exclude (XOR)',
                  action: () =>
                    window.dispatchEvent(new CustomEvent('pencil-bool-op', { detail: 'exclude' })),
                },
                {
                  id: 'flatten',
                  label: 'Flatten selection (union → single path)',
                  action: () => window.dispatchEvent(new Event('pencil-flatten')),
                },
                {
                  id: 'outline-stroke',
                  label: 'Outline stroke (stroke → filled path)',
                  action: () => window.dispatchEvent(new Event('pencil-outline-stroke')),
                },
                ...(isAIReviewEnabled()
                  ? [{ id: 'ai-review', label: '🤖 AI Design Review', action: () => setShowAIReview(true) }]
                  : []),
                ...(isAIGenerateEnabled()
                  ? [
                      {
                        id: 'ai-generate',
                        label: '🪄 AI Design Generator',
                        shortcut: 'Cmd+K',
                        action: () => setShowAIGenerate(true),
                      },
                    ]
                  : []),
                { id: 'fit-view', label: 'Fit to View', shortcut: 'Cmd+0', action: resetView },
                { id: 'zoom-100', label: 'Zoom to 100%', shortcut: 'Cmd+1', action: zoomTo100 },
                {
                  id: 'shortcuts',
                  label: 'Show Keyboard Shortcuts',
                  shortcut: 'Cmd+/',
                  action: () => setShowShortcuts(true),
                },
                { id: 'export', label: 'Export .pen', shortcut: 'Cmd+S', action: () => {} },
                { id: 'save-as', label: 'Save As...', shortcut: 'Cmd+Shift+S', action: () => {} },
              ] satisfies Command[]
            }
            onClose={() => setShowCommandPalette(false)}
          />
        )}
        <NudgeHandler />
        <ZoomToSelected onZoomTo={zoomToRect} />
        <VimTextObjects vimMode={vimMode} />
        {vimMode && <VimBadge />}
        <ContextMenu />
        <ToolShortcuts />
        <FloatingTextToolbar svgRef={svgRef} />
        <ImageDropHandler
          svgRef={svgRef}
          containerRef={containerRef}
          viewCenter={{ x: camera.cx, y: camera.cy }}
        />
      </div>
    </EditorProvider>
  );
}
