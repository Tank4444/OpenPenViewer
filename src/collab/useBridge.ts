/**
 * MCP Bridge 接続フック。
 * ローカルの collab-bridge (WebSocket) に接続し、
 * Claude Code / Antigravity / Cursor からのリアルタイム編集を受信/送信する。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PenDocument } from '../pen/types';

const DEFAULT_URL = 'ws://localhost:4567';
const LS_MCP_URL = 'openpenviewer.mcp.url';

function readSavedUrl(): string {
  try {
    return localStorage.getItem(LS_MCP_URL) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export interface BridgeState {
  connected: boolean;
  connecting: boolean;
  url: string;
  error: string | null;
}

/** 2つのドキュメントの children を浅く比較し、変更されたノードIDを返す */
function detectChangedNodes(oldDoc: PenDocument | null, newDoc: PenDocument): string[] {
  if (!oldDoc) return [];
  const oldStr = JSON.stringify(oldDoc.children);
  const newStr = JSON.stringify(newDoc.children);
  if (oldStr === newStr) return [];

  const changed: string[] = [];
  const oldMap = new Map(oldDoc.children.map((n) => [n.id, JSON.stringify(n)]));
  for (const n of newDoc.children) {
    const oldJson = oldMap.get(n.id);
    if (oldJson !== JSON.stringify(n)) {
      changed.push(n.id);
    }
  }
  return changed;
}

/** Render current SVG canvas (or a specific node by ID) to a PNG dataUrl */
async function captureCanvasPng(
  nodeId?: string,
  scale = 2,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const svg = document.querySelector('.viewer__svg') as SVGSVGElement | null;
  if (!svg) throw new Error('Editor SVG canvas is not mounted');

  let vx = 0;
  let vy = 0;
  let vw = 0;
  let vh = 0;

  if (nodeId) {
    const safeId = CSS.escape ? CSS.escape(nodeId) : nodeId.replace(/"/g, '\\"');
    const el = svg.querySelector(`[data-node-id="${safeId}"]`) as SVGGraphicsElement | null;
    if (!el) throw new Error(`Node not found on canvas: ${nodeId}`);
    const boundsEl = el.querySelector('[data-node-bounds="true"]') as SVGRectElement | null;
    if (boundsEl) {
      vx = Number(boundsEl.getAttribute('x') ?? 0);
      vy = Number(boundsEl.getAttribute('y') ?? 0);
      vw = Number(boundsEl.getAttribute('width') ?? 0);
      vh = Number(boundsEl.getAttribute('height') ?? 0);
    }
    if (vw <= 0 || vh <= 0) {
      const box = el.getBBox();
      vx = box.x;
      vy = box.y;
      vw = box.width;
      vh = box.height;
    }
  } else {
    const vb = (svg.getAttribute('viewBox') ?? '0 0 1200 800').split(/\s+/).map(Number);
    [vx, vy, vw, vh] = vb.length === 4 ? vb : [0, 0, 1200, 800];
  }

  if (vw <= 0 || vh <= 0) throw new Error('Target has zero size');

  const clampedScale = Math.max(1, Math.min(4, scale));
  const maxDim = 2400;
  const effScale = Math.min(clampedScale, maxDim / Math.max(vw, vh));
  const outW = Math.max(1, Math.round(vw * effScale));
  const outH = Math.max(1, Math.round(vh * effScale));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  clone.setAttribute('width', String(outW));
  clone.setAttribute('height', String(outH));

  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to rasterize SVG'));
      image.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, outW, outH);
    return { dataUrl: canvas.toDataURL('image/png'), width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function useBridge() {
  const [state, setState] = useState<BridgeState>(() => ({
    connected: false,
    connecting: false,
    url: readSavedUrl(),
    error: null,
  }));
  const wsRef = useRef<WebSocket | null>(null);
  const onDocUpdateRef = useRef<((doc: PenDocument) => void) | null>(null);
  const currentDocRef = useRef<PenDocument | null>(null);

  const setRemoteHandler = useCallback((cb: ((doc: PenDocument) => void) | null) => {
    onDocUpdateRef.current = cb;
  }, []);

  const setBridgeUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    try {
      if (trimmed) localStorage.setItem(LS_MCP_URL, trimmed);
      else localStorage.removeItem(LS_MCP_URL);
    } catch {
      // ignore
    }
    setState((prev) => ({ ...prev, url: trimmed || DEFAULT_URL, error: null }));
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState((prev) => ({ ...prev, connected: false, connecting: false }));
  }, []);

  const connect = useCallback(
    (url: string, doc: PenDocument, onDocUpdate?: (doc: PenDocument) => void) => {
      disconnect();

      if (onDocUpdate) onDocUpdateRef.current = onDocUpdate;
      currentDocRef.current = doc;
      const targetUrl = url.trim() || DEFAULT_URL;
      setState({ connected: false, connecting: true, url: targetUrl, error: null });

      let ws: WebSocket;
      try {
        ws = new WebSocket(targetUrl);
      } catch (err) {
        setState({
          connected: false,
          connecting: false,
          url: targetUrl,
          error: err instanceof Error ? err.message : 'Invalid WebSocket URL',
        });
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setState({ connected: true, connecting: false, url: targetUrl, error: null });
        ws.send(JSON.stringify({ type: 'pen-doc', doc }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'pen-doc' && msg.doc) {
            const changedIds = detectChangedNodes(currentDocRef.current, msg.doc);
            currentDocRef.current = msg.doc;
            onDocUpdateRef.current?.(msg.doc);
            if (changedIds.length > 0) {
              window.dispatchEvent(new CustomEvent('pencil-edit-animate', { detail: changedIds }));
            }
          } else if (msg.type === 'screenshot-request' && msg.requestId) {
            void captureCanvasPng(msg.nodeId, msg.scale)
              .then((shot) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'screenshot-response',
                      requestId: msg.requestId,
                      dataUrl: shot.dataUrl,
                      mimeType: 'image/png',
                      width: shot.width,
                      height: shot.height,
                    }),
                  );
                }
              })
              .catch((err) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'screenshot-response',
                      requestId: msg.requestId,
                      error: err instanceof Error ? err.message : String(err),
                    }),
                  );
                }
              });
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
          error: prev.connecting ? 'Не удалось подключиться к MCP Bridge (запустите npm run mcp-bridge)' : prev.error,
        }));
        wsRef.current = null;
      };

      ws.onerror = () => {
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
          error: 'Не удалось подключиться к MCP Bridge (запустите npm run mcp-bridge)',
        }));
        ws.close();
      };
    },
    [disconnect],
  );

  const syncDoc = useCallback((doc: PenDocument) => {
    currentDocRef.current = doc;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'pen-doc', doc }));
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    bridge: state,
    connectBridge: connect,
    disconnectBridge: disconnect,
    syncBridgeDoc: syncDoc,
    setBridgeUrl,
    setBridgeRemoteHandler: setRemoteHandler,
  };
}
