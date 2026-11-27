import { memo } from 'react';
import type { FrameEntry } from './frames';
import { Toolbar } from './Toolbar';
import { ZoomInput } from './ZoomInput';
import { AlignToolbar } from './AlignToolbar';
import { GridSnapToggle } from './GridSnapToggle';
import { ExportButton } from './ExportButton';
import { CollabBar } from './CollabBar';
import { McpBar } from './McpBar';
import { MissingFontsBadge } from './MissingFontsBadge';
import type { CollabState } from '../../collab/useCollab';
import type { BridgeState } from '../../collab/useBridge';
import { isAIGenerateEnabled } from '../../utils/aiGenerate';

export interface EditorToolbarProps {
  fileName?: string;
  savedToast?: string | null;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onOpenLocal?: () => void;
  onBack?: () => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (percent: number) => void;
  onResetView: () => void;
  frames: FrameEntry[];
  activeFrameId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onSelectFrame: (frame: FrameEntry) => void;
  onOpenAIGenerate: () => void;
  onOpenShortcuts: () => void;
  collab: CollabState;
  onStartCollab: () => void;
  onJoinRoom: (roomId: string) => void;
  onDisconnectCollab: () => void;
  onChangeCollabName: (name: string) => void;
  onChangeCollabColor: (color: string) => void;
  onChangeCollabSignaling: (url: string) => void;
  roomUrl: string;
  bridge: BridgeState;
  onConnectBridge: (url: string) => void;
  onDisconnectBridge: () => void;
  onChangeBridgeUrl: (url: string) => void;
}

export const EditorToolbar = memo(function EditorToolbar({
  fileName,
  savedToast,
  theme = 'dark',
  onToggleTheme,
  onOpenLocal,
  onBack,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onResetView,
  frames,
  activeFrameId,
  canGoBack,
  canGoForward,
  onNavigateBack,
  onNavigateForward,
  onSelectFrame,
  onOpenAIGenerate,
  onOpenShortcuts,
  collab,
  onStartCollab,
  onJoinRoom,
  onDisconnectCollab,
  onChangeCollabName,
  onChangeCollabColor,
  onChangeCollabSignaling,
  roomUrl,
  bridge,
  onConnectBridge,
  onDisconnectBridge,
  onChangeBridgeUrl,
}: EditorToolbarProps) {
  return (
    <div className="viewer__toolbar">
      {onBack && (
        <button
          type="button"
          className="viewer__nav-btn"
          onClick={onBack}
          title="На стартовый экран"
          aria-label="На стартовый экран"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {onOpenLocal && (
        <button
          type="button"
          className="viewer__nav-btn"
          onClick={onOpenLocal}
          title="Открыть файл (Ctrl+O)"
          aria-label="Открыть файл"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      {fileName && (
        <span className="viewer__file-pill" title={fileName}>
          {fileName}
        </span>
      )}
      {savedToast && (
        <span className="viewer__saved-pill" title={`Saved ${savedToast}`}>
          Saved ✓
        </span>
      )}
      {(onBack || onOpenLocal || fileName) && <span className="viewer__separator" />}
      <Toolbar />
      <span className="viewer__separator" />
      <button
        type="button"
        className="viewer__zoom-btn"
        title="Zoom out (Cmd+-)"
        onClick={onZoomOut}
      >
        -
      </button>
      <ZoomInput zoomPercent={zoomPercent} onZoomChange={onZoomChange} />
      <button
        type="button"
        className="viewer__zoom-btn"
        title="Zoom in (Cmd++)"
        onClick={onZoomIn}
      >
        +
      </button>
      <span className="viewer__separator" />
      <button type="button" className="viewer__zoom-btn" title="Fit to view (Cmd+0)" onClick={onResetView}>
        Fit
      </button>

      {frames.length > 0 && (
        <>
          <span className="viewer__separator" />
          <div className="viewer__frame-nav">
            <button
              type="button"
              className="viewer__zoom-btn"
              title="Back (Cmd+[)"
              disabled={!canGoBack}
              onClick={onNavigateBack}
            >
              &#9664;
            </button>
            <button
              type="button"
              className="viewer__zoom-btn"
              title="Forward (Cmd+])"
              disabled={!canGoForward}
              onClick={onNavigateForward}
            >
              &#9654;
            </button>
            <select
              className="viewer__frame-select"
              value={activeFrameId ?? ''}
              onChange={(e) => {
                const frame = frames.find((f) => f.id === e.target.value);
                if (frame) onSelectFrame(frame);
              }}
            >
              <option value="" disabled>
                Frames
              </option>
              {frames.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <span style={{ flex: 1 }} />
      <AlignToolbar />
      <span className="viewer__separator" />
      <GridSnapToggle />
      <span className="viewer__separator" />
      {isAIGenerateEnabled() && (
        <>
          <button
            type="button"
            className="viewer__zoom-btn viewer__ai-btn"
            title="AI Design Generator (Cmd+K)"
            onClick={onOpenAIGenerate}
          >
            🪄 AI
          </button>
          <span className="viewer__separator" />
        </>
      )}
      <CollabBar
        collab={collab}
        onStartCollab={onStartCollab}
        onJoinRoom={onJoinRoom}
        onDisconnect={onDisconnectCollab}
        onChangeName={onChangeCollabName}
        onChangeColor={onChangeCollabColor}
        onChangeSignaling={onChangeCollabSignaling}
        roomUrl={roomUrl}
      />
      <McpBar
        bridge={bridge}
        onConnect={onConnectBridge}
        onDisconnect={onDisconnectBridge}
        onChangeUrl={onChangeBridgeUrl}
      />
      <MissingFontsBadge />
      <span className="viewer__separator" />
      <ExportButton />
      {onToggleTheme && (
        <>
          <span className="viewer__separator" />
          <button
            type="button"
            className="viewer__zoom-btn"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            aria-label="Переключить тему"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </>
      )}
      <span className="viewer__separator" />
      <button
        type="button"
        className="viewer__zoom-btn"
        title="Shortcuts (Cmd+/)"
        onClick={onOpenShortcuts}
      >
        ?
      </button>
    </div>
  );
});

