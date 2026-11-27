/**
 * P2P 共同編集フック。
 * Yjs (CRDT) + y-webrtc で WebRTC 経由のリアルタイム同期を実現。
 *
 * "No trace, no server, no cost."
 * - 全員が離れたらデータは消える
 * - ドキュメントの中身はサーバーを経由しない (WebRTC で peer 間を直接流れる)
 * - シグナリングサーバーは接続確立のメタデータのみ中継する
 *   (VITE_COLLAB_SIGNALING で指定。未指定なら同一ブラウザのタブ間のみ同期)
 *
 * 同期の中身:
 * - ドキュメント本体 (children) を Y.Map の 1 キーに JSON で格納
 * - awareness で各ユーザーの presence (名前/色/カーソル/選択) を共有
 *
 * NOTE: children は 1 キーにまとめて持つため、同時刻に別ノードを編集すると
 *       後勝ちになる。ノード単位の衝突解決は将来の課題 (v2)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as YType from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import type { PenDocument } from '../pen/types';
import { isTauriHost, startCollabHost, type CollabHostInfo } from '../platform/hostBridge';

export interface CollabPeer {
  id: string;
  name: string;
  color: string;
  /** SVG 座標系でのカーソル位置 (未送信時は undefined) */
  cursor?: { x: number; y: number };
  /** 選択中ノード ID 群 */
  selection?: string[];
}

export interface CollabState {
  connected: boolean;
  roomId: string | null;
  peers: CollabPeer[];
  /** 自分のユーザー名 */
  userName: string;
  /** 自分のアバター色 */
  selfColor: string;
  /** Custom signaling server URL (empty = env default / same-browser BroadcastChannel) */
  signalingUrl: string;
  /** Embedded desktop LAN host info when hosting from Tauri */
  hostInfo: CollabHostInfo | null;
}

/** リモート由来でない (= 自分が書いた) Y トランザクションの目印 */
const LOCAL_ORIGIN = 'pencil-local';

const LS_NAME = 'openpenviewer.collab.userName';
const LS_COLOR = 'openpenviewer.collab.color';
const LS_SIGNALING = 'openpenviewer.collab.signaling';

/**
 * WebRTC シグナリングサーバー (カンマ区切りで複数可)。
 * VITE_COLLAB_SIGNALING 未設定なら空 = 同一ブラウザのタブ間のみ
 * (BroadcastChannel) で同期する。クロスデバイスには workers/collab-signaling
 * をデプロイして wss URL を設定する。
 */
const ENV_SIGNALING_SERVERS: string[] = ((import.meta.env.VITE_COLLAB_SIGNALING as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const PEER_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, val: string): void {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function generateRoomId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateUserName(): string {
  const names = ['Monet', 'Renoir', 'Degas', 'Cézanne', 'Pissarro', 'Sisley', 'Morisot', 'Cassatt'];
  return names[Math.floor(Math.random() * names.length)];
}

type RemoteDocHandler = (doc: PenDocument) => void;

export function useCollab() {
  const [state, setState] = useState<CollabState>(() => ({
    connected: false,
    roomId: null,
    peers: [],
    userName: readStorage(LS_NAME) || generateUserName(),
    selfColor: readStorage(LS_COLOR) || PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)],
    signalingUrl: readStorage(LS_SIGNALING),
    hostInfo: null,
  }));

  const ydocRef = useRef<YType.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  const signalingRef = useRef(state.signalingUrl);
  useEffect(() => {
    signalingRef.current = state.signalingUrl;
  }, [state.signalingUrl]);
  /**
   * join の世代番号。yjs / y-webrtc の動的 import 中に disconnect や
   * 別ルームへの join が起きた場合、古い読み込みが完了しても
   * Provider を据え付けないようにするためのガード。
   */
  const joinGenerationRef = useRef(0);
  /** リモート編集を受け取って EditorContext に流すハンドラ (CollabSync が登録) */
  const onDocUpdateRef = useRef<RemoteDocHandler | null>(null);
  /** awareness に書き込む user フィールドを最新に保つための参照 */
  const userRef = useRef({ name: state.userName, color: state.selfColor });
  // レンダー中に ref を書くと concurrent レンダーで壊れうる (react-hooks/refs, #78)
  useEffect(() => {
    userRef.current = { name: state.userName, color: state.selfColor };
  }, [state.userName, state.selfColor]);

  /** CollabSync から呼ぶ: リモート doc 受信ハンドラを登録 */
  const setRemoteHandler = useCallback((cb: RemoteDocHandler | null) => {
    onDocUpdateRef.current = cb;
  }, []);

  /** 切断 */
  const disconnect = useCallback(() => {
    joinGenerationRef.current += 1;
    providerRef.current?.destroy();
    ydocRef.current?.destroy();
    providerRef.current = null;
    ydocRef.current = null;
    setState((prev) => ({ ...prev, connected: false, roomId: null, peers: [] }));
  }, []);

  /** 動的 import 済みの yjs / y-webrtc を使って実際にルームを構築する */
  const setupRoom = useCallback(
    (
      Y: typeof YType,
      WebrtcProvider: typeof import('y-webrtc').WebrtcProvider,
      roomId: string,
      initialDoc: PenDocument | null,
      hostInfo: CollabHostInfo | null = null,
    ) => {
      const ydoc = new Y.Doc();
      const ymap = ydoc.getMap('pen-document');

      // 初期ドキュメントを seed (作成者のみ。参加者は null を渡すので素通り)
      if (initialDoc) {
        ydoc.transact(() => {
          ymap.set('version', initialDoc.version);
          ymap.set('children', JSON.stringify(initialDoc.children));
          if (initialDoc.variables) ymap.set('variables', JSON.stringify(initialDoc.variables));
          if (initialDoc.themes) ymap.set('themes', JSON.stringify(initialDoc.themes));
        }, LOCAL_ORIGIN);
      }

      // Y.Map の変更を監視 — 自分の書き込み (LOCAL_ORIGIN) は無視してエコーを防ぐ
      ymap.observe((_event, transaction) => {
        if (transaction.origin === LOCAL_ORIGIN) return;
        const version = (ymap.get('version') as string) ?? '1.0';
        const childrenStr = ymap.get('children') as string | undefined;
        if (!childrenStr) return;
        const varsStr = ymap.get('variables') as string | undefined;
        const themesStr = ymap.get('themes') as string | undefined;
        try {
          const nextDoc: PenDocument = {
            version,
            children: JSON.parse(childrenStr),
            ...(varsStr ? { variables: JSON.parse(varsStr) } : {}),
            ...(themesStr ? { themes: JSON.parse(themesStr) } : {}),
          };
          onDocUpdateRef.current?.(nextDoc);
        } catch {
          // ignore parse errors
        }
      });

      const customSignaling = signalingRef.current
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const isCodeInvite =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).has('code');
      const autoHostSignaling =
        isCodeInvite && typeof window !== 'undefined' && window.location.hostname
          ? [`ws://${window.location.hostname}:4444`]
          : [];
      const signaling =
        customSignaling.length > 0
          ? customSignaling
          : hostInfo
            ? [`ws://127.0.0.1:${hostInfo.port}`]
            : autoHostSignaling.length > 0
              ? autoHostSignaling
              : ENV_SIGNALING_SERVERS;

      // WebRTC Provider
      const provider = new WebrtcProvider(`pencil-viewer-${roomId}`, ydoc, {
        signaling,
      });

      // Awareness (自分の presence)
      provider.awareness.setLocalStateField('user', userRef.current);

      // peers の監視 (名前/色/カーソル/選択をまとめて反映)
      const updatePeers = () => {
        const peers: CollabPeer[] = [];
        provider.awareness.getStates().forEach((s, clientId) => {
          if (clientId === ydoc.clientID) return;
          const st = s as {
            user?: { name: string; color: string };
            cursor?: { x: number; y: number };
            selection?: string[];
          };
          if (st.user) {
            peers.push({
              id: String(clientId),
              name: st.user.name,
              color: st.user.color,
              cursor: st.cursor,
              selection: st.selection,
            });
          }
        });
        setState((prev) => ({ ...prev, peers }));
      };
      provider.awareness.on('change', updatePeers);

      ydocRef.current = ydoc;
      providerRef.current = provider;

      setState((prev) => ({ ...prev, connected: true, roomId, hostInfo }));
    },
    [],
  );

  /**
   * ルームに接続する。
   * @param roomId      接続先ルーム ID
   * @param initialDoc  ルーム作成者なら seed する doc / 参加者は null
   */
  const joinRoom = useCallback(
    (roomId: string, initialDoc: PenDocument | null) => {
      disconnect(); // ここで世代が 1 進む
      const generation = joinGenerationRef.current;

      // yjs / y-webrtc は初期バンドルから外してある (#68)。
      // 実際にルームへ入るときに初めて取りに行く。
      void (async () => {
        try {
          const hostInfoPromise =
            initialDoc && isTauriHost() && !signalingRef.current ? startCollabHost() : Promise.resolve(null);
          const [Y, webrtc, hostInfo] = await Promise.all([
            import('yjs'),
            import('y-webrtc'),
            hostInfoPromise,
          ]);

          // 読み込み中に disconnect / 別ルームへの join が起きていたら破棄
          if (joinGenerationRef.current !== generation) return;

          setupRoom(Y, webrtc.WebrtcProvider, roomId, initialDoc, hostInfo);
        } catch (err) {
          // import 失敗や Provider の初期化失敗を握り潰さない。
          // 接続できなかったことが分かるよう未接続状態に戻す。
          console.error('[collab] failed to join room', err);
          if (joinGenerationRef.current === generation) {
            setState((prev) => ({ ...prev, connected: false, roomId: null }));
          }
        }
      })();
    },
    [disconnect, setupRoom],
  );

  /** ルームを新規作成して接続。作成者の doc を seed する */
  const createRoom = useCallback(
    (doc: PenDocument): string => {
      const roomId = generateRoomId();
      joinRoom(roomId, doc);
      return roomId;
    },
    [joinRoom],
  );

  /** ローカルのドキュメント変更を Y.Doc に反映 (LOCAL_ORIGIN 付き) */
  const syncDoc = useCallback((doc: PenDocument) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const ymap = ydoc.getMap('pen-document');
    ydoc.transact(() => {
      ymap.set('version', doc.version);
      ymap.set('children', JSON.stringify(doc.children));
      if (doc.variables) ymap.set('variables', JSON.stringify(doc.variables));
      if (doc.themes) ymap.set('themes', JSON.stringify(doc.themes));
    }, LOCAL_ORIGIN);
  }, []);

  /** 自分のカーソル位置を awareness に送信 (null でクリア) */
  const setLocalCursor = useCallback((pos: { x: number; y: number } | null) => {
    providerRef.current?.awareness.setLocalStateField('cursor', pos ?? undefined);
  }, []);

  /** 自分の選択ノードを awareness に送信 */
  const setLocalSelection = useCallback((ids: string[]) => {
    providerRef.current?.awareness.setLocalStateField('selection', ids);
  }, []);

  /** URL にルーム ID を付与した招待リンクを返す (形式: http://<ip/hostname>:<port>/?code=xxxx) */
  const getRoomUrl = useCallback(() => {
    if (!state.roomId) return '';
    const url = new URL(window.location.href);
    const hostInfo = state.hostInfo;
    if (hostInfo) {
      const preferredHost =
        hostInfo.inDomain && hostInfo.hostname ? hostInfo.hostname : hostInfo.ip;
      url.protocol = 'http:';
      url.hostname = preferredHost;
      if (!url.port) url.port = '5173';
    }
    url.search = `?code=${encodeURIComponent(state.roomId)}`;
    return url.toString();
  }, [state.roomId, state.hostInfo]);

  /** ユーザー名を変更 (接続中なら awareness にも反映) */
  const setUserName = useCallback((name: string) => {
    writeStorage(LS_NAME, name);
    setState((prev) => {
      providerRef.current?.awareness.setLocalStateField('user', { name, color: prev.selfColor });
      return { ...prev, userName: name };
    });
  }, []);

  /** アバター色を変更 */
  const setSelfColor = useCallback((color: string) => {
    writeStorage(LS_COLOR, color);
    setState((prev) => {
      providerRef.current?.awareness.setLocalStateField('user', { name: prev.userName, color });
      return { ...prev, selfColor: color };
    });
  }, []);

  /** Signaling サーバー URL を変更 */
  const setSignalingUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    writeStorage(LS_SIGNALING, trimmed);
    signalingRef.current = trimmed;
    setState((prev) => ({ ...prev, signalingUrl: trimmed }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // 世代を進めておかないと、動的 import の解決中に unmount された場合に
      // setupRoom が走って破棄されない Provider が残る。
      joinGenerationRef.current += 1;
      providerRef.current?.destroy();
      ydocRef.current?.destroy();
    };
  }, []);

  return {
    collab: state,
    createRoom,
    joinRoom,
    syncDoc,
    disconnect,
    getRoomUrl,
    setUserName,
    setSelfColor,
    setSignalingUrl,
    setRemoteHandler,
    setLocalCursor,
    setLocalSelection,
  };
}
