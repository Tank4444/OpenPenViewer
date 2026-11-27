import { memo, useEffect, useRef, useState } from 'react';
import type { BridgeState } from '../../collab/useBridge';
import { isTauriHost, startMcpBridge, stopMcpBridge } from '../../platform/hostBridge';

export interface McpBarProps {
  bridge: BridgeState;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  onChangeUrl: (url: string) => void;
}

function buildMcpConfigJson(scriptPath?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openpenviewer: {
          command: 'node',
          args: [scriptPath || 'tools/collab-bridge/index.js'],
        },
      },
    },
    null,
    2,
  );
}

export const McpBar = memo(function McpBar({
  bridge,
  onConnect,
  onDisconnect,
}: McpBarProps) {
  const [open, setOpen] = useState(false);
  const [scriptPath, setScriptPath] = useState<string>('');
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isOn = bridge.connected || bridge.connecting || starting;

  const handleToggle = async () => {
    setLocalError(null);
    if (isOn) {
      onDisconnect();
      await stopMcpBridge();
      setStarting(false);
      return;
    }

    setStarting(true);
    try {
      let targetUrl = bridge.url || 'ws://localhost:4567';
      if (isTauriHost()) {
        const info = await startMcpBridge();
        if (info) {
          targetUrl = info.url;
          setScriptPath(info.scriptPath);
        }
        // Wait until the local bridge HTTP/WS server is actually listening (up to 3s)
        const httpUrl = targetUrl.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
        for (let i = 0; i < 15; i++) {
          try {
            const res = await fetch(`${httpUrl}/status`);
            if (res.ok) break;
          } catch {
            // server still booting
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      onConnect(targetUrl);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleCopyConfig = async () => {
    const json = buildMcpConfigJson(scriptPath);
    try {
      await navigator.clipboard.writeText(json);
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 1800);
    } catch {
      window.prompt('Настройки MCP (JSON):', json);
    }
  };

  const errorText = localError || bridge.error;

  return (
    <div className="collab-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`collab-trigger${bridge.connected ? ' collab-trigger--live' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={bridge.connected ? 'MCP сервер запущен' : 'MCP сервер'}
      >
        <span className={`collab-trigger__dot${bridge.connected ? ' collab-trigger__dot--live' : ''}`} />
        <span>MCP</span>
      </button>

      {open && (
        <div className="collab-popover" role="dialog" aria-label="MCP Сервер">
          <div className="collab-popover__head">
            <span className="collab-popover__title">MCP Сервер</span>
            {bridge.connected && <span className="collab-popover__badge">Включён</span>}
          </div>

          <div className="mcp-toggle-row">
            <div className="mcp-toggle-info">
              <span className="mcp-toggle-label">
                {starting || bridge.connecting
                  ? 'Запуск…'
                  : bridge.connected
                    ? 'Сервер работает'
                    : 'Сервер выключен'}
              </span>
              <span className="mcp-toggle-sub">{bridge.url}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isOn}
              className={`mcp-switch${isOn ? ' mcp-switch--on' : ''}`}
              onClick={() => void handleToggle()}
              disabled={starting}
              aria-label="Включить или выключить MCP сервер"
            >
              <span className="mcp-switch__thumb" />
            </button>
          </div>

          {errorText && (
            <span className="collab-popover__hint" style={{ color: '#ef4444' }}>
              {errorText}
            </span>
          )}

          <div className="collab-popover__section">
            <button
              type="button"
              className="collab-popover__btn collab-popover__btn--secondary"
              onClick={() => void handleCopyConfig()}
            >
              {copiedConfig ? '✓ Настройки скопированы' : 'Копировать настройки MCP (JSON)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
