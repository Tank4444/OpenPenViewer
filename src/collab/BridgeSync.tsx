import { useCallback, useEffect, useRef } from 'react';
import { useEditorActions, useEditorSelector } from '../pen/state/EditorContext';
import type { PenDocument, PenNode } from '../pen/types';

function sanitizeNodes(nodes: unknown): PenNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: PenNode[] = [];
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.type !== 'string' || typeof rec.id !== 'string' || !rec.id) continue;
    if (Array.isArray(rec.children)) {
      out.push({ ...rec, children: sanitizeNodes(rec.children) } as PenNode);
    } else {
      out.push(rec as unknown as PenNode);
    }
  }
  return out;
}

interface Props {
  connected: boolean;
  syncDoc: (doc: PenDocument) => void;
  setRemoteHandler: (cb: ((doc: PenDocument) => void) | null) => void;
}

/**
 * Bidirectional sync bridge between EditorContext and MCP WebSocket Bridge.
 */
export function BridgeSync({ connected, syncDoc, setRemoteHandler }: Props) {
  const rawDoc = useEditorSelector((s) => s.rawDoc);
  const { replaceDocChildren, upsertVariable } = useEditorActions();
  const lastSyncedRef = useRef<string>('');
  const timerRef = useRef<number | null>(null);

  const handleRemote = useCallback(
    (doc: PenDocument) => {
      try {
        const safeChildren = sanitizeNodes(doc.children);
        const json = JSON.stringify({ children: safeChildren, variables: doc.variables });
        if (json === lastSyncedRef.current) return;
        lastSyncedRef.current = json;
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        replaceDocChildren(safeChildren);
        if (doc.variables && typeof doc.variables === 'object') {
          for (const [k, v] of Object.entries(doc.variables as Record<string, unknown>)) {
            if (v && typeof v === 'object' && 'type' in v && 'value' in v) {
              const def = v as { type: 'color' | 'number' | 'boolean' | 'string'; value: string | number | boolean };
              upsertVariable(k, def);
            }
          }
        }
      } catch (err) {
        console.error('[BridgeSync] failed to apply remote MCP update:', err);
      }
    },
    [replaceDocChildren, upsertVariable],
  );

  useEffect(() => {
    if (!connected) {
      setRemoteHandler(null);
      lastSyncedRef.current = '';
      return;
    }
    setRemoteHandler(handleRemote);
    return () => setRemoteHandler(null);
  }, [connected, handleRemote, setRemoteHandler]);

  useEffect(() => {
    if (!connected) return;
    const json = JSON.stringify({ children: rawDoc.children, variables: rawDoc.variables });
    if (json === lastSyncedRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastSyncedRef.current = json;
      syncDoc(rawDoc);
    }, 120);
  }, [connected, rawDoc, syncDoc]);

  return null;
}

