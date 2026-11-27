import { memo, useEffect, useRef, useState } from 'react';
import { PEER_COLORS, type CollabState } from '../../collab/useCollab';

export interface CollabBarProps {
  collab: CollabState;
  onStartCollab: () => void;
  onJoinRoom: (roomId: string) => void;
  onDisconnect: () => void;
  onChangeName: (name: string) => void;
  onChangeColor: (color: string) => void;
  onChangeSignaling: (url: string) => void;
  roomUrl: string;
}

/** Extract room code from either raw code ("abc12345") or full invite URL ("https://.../?room=abc12345") */
function parseRoomInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://') || trimmed.includes('code=') || trimmed.includes('room=')) {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://example.com/?${trimmed.replace(/^\?/, '')}`);
      const r = url.searchParams.get('code') ?? url.searchParams.get('room');
      if (r) return r.trim().toLowerCase();
    }
  } catch {
    // fallback to raw string
  }
  return trimmed.toLowerCase();
}

export const CollabBar = memo(function CollabBar({
  collab,
  onStartCollab,
  onJoinRoom,
  onDisconnect,
  onChangeName,
  onChangeColor,
  onChangeSignaling,
  roomUrl,
}: CollabBarProps) {
  const [open, setOpen] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [copiedWhat, setCopiedWhat] = useState<'code' | 'url' | null>(null);
  const [showSignaling, setShowSignaling] = useState(false);
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

  const copyText = async (text: string, kind: 'code' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedWhat(kind);
      setTimeout(() => setCopiedWhat(null), 1800);
    } catch {
      window.prompt(kind === 'code' ? 'Код комнаты:' : 'Ссылка-приглашение:', text);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = parseRoomInput(joinInput);
    if (!code) return;
    onJoinRoom(code);
    setJoinInput('');
  };

  return (
    <div className="collab-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`collab-trigger${collab.connected ? ' collab-trigger--live' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={collab.connected ? `Комната: ${collab.roomId}` : 'Совместная работа (Collab)'}
      >
        <span className={`collab-trigger__dot${collab.connected ? ' collab-trigger__dot--live' : ''}`} />
        <span>{collab.connected ? 'Live' : 'Collab'}</span>
        {collab.connected && (
          <span className="collab-trigger__count">{collab.peers.length + 1}</span>
        )}
      </button>

      {open && (
        <div className="collab-popover" role="dialog" aria-label="Совместная работа">
          <div className="collab-popover__head">
            <span className="collab-popover__title">Совместная работа</span>
            {collab.connected && <span className="collab-popover__badge">Live</span>}
          </div>

          <div className="collab-popover__section">
            <label className="collab-popover__label" htmlFor="collab-name-input">
              Ваше имя и цвет
            </label>
            <input
              id="collab-name-input"
              type="text"
              className="collab-popover__input"
              value={collab.userName}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="Имя участника"
              maxLength={24}
            />
            <div className="collab-popover__colors">
              {PEER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`collab-popover__swatch${collab.selfColor === color ? ' collab-popover__swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => onChangeColor(color)}
                  aria-label={`Выбрать цвет ${color}`}
                />
              ))}
            </div>
          </div>

          {!collab.connected ? (
            <>
              <div className="collab-popover__section">
                <button
                  type="button"
                  className="collab-popover__btn collab-popover__btn--primary"
                  onClick={onStartCollab}
                >
                  Создать комнату
                </button>
              </div>

              <form className="collab-popover__section" onSubmit={handleJoinSubmit}>
                <label className="collab-popover__label" htmlFor="collab-join-input">
                  Присоединиться по коду или ссылке
                </label>
                <div className="collab-popover__row">
                  <input
                    id="collab-join-input"
                    type="text"
                    className="collab-popover__input"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value)}
                    placeholder="Код комнаты или ?room=..."
                  />
                  <button
                    type="submit"
                    className="collab-popover__btn collab-popover__btn--secondary"
                    disabled={!joinInput.trim()}
                  >
                    Войти
                  </button>
                </div>
              </form>

              <div className="collab-popover__section">
                <button
                  type="button"
                  className="collab-popover__link"
                  onClick={() => setShowSignaling((v) => !v)}
                >
                  {showSignaling ? '▾ Скрыть настройки сервера' : '▸ Signaling-сервер (wss://)'}
                </button>
                {showSignaling && (
                  <div className="collab-popover__signaling">
                    <input
                      type="text"
                      className="collab-popover__input"
                      value={collab.signalingUrl}
                      onChange={(e) => onChangeSignaling(e.target.value)}
                      placeholder="wss://your-signaling-server.workers.dev"
                    />
                    <span className="collab-popover__hint">
                      Пусто = синхронизация между вкладками на одном ПК. Для разных ПК укажите wss:// сервер.
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="collab-popover__section">
                <span className="collab-popover__label">Код комнаты</span>
                <div className="collab-popover__code-box">
                  <code className="collab-popover__code">{collab.roomId}</code>
                  <button
                    type="button"
                    className="collab-popover__btn collab-popover__btn--secondary collab-popover__btn--sm"
                    onClick={() => void copyText(collab.roomId ?? '', 'code')}
                  >
                    {copiedWhat === 'code' ? '✓ Скопировано' : 'Код'}
                  </button>
                  <button
                    type="button"
                    className="collab-popover__btn collab-popover__btn--secondary collab-popover__btn--sm"
                    onClick={() => void copyText(roomUrl, 'url')}
                  >
                    {copiedWhat === 'url' ? '✓ Скопировано' : 'Ссылка'}
                  </button>
                </div>
              </div>

              <div className="collab-popover__section">
                <span className="collab-popover__label">
                  Участники ({collab.peers.length + 1})
                </span>
                <ul className="collab-popover__peers">
                  <li className="collab-popover__peer">
                    <span
                      className="collab-popover__avatar"
                      style={{ background: collab.selfColor }}
                    >
                      {(collab.userName[0] ?? 'U').toUpperCase()}
                    </span>
                    <span className="collab-popover__peer-name">
                      {collab.userName} <small>(вы)</small>
                    </span>
                  </li>
                  {collab.peers.map((p) => (
                    <li key={p.id} className="collab-popover__peer">
                      <span
                        className="collab-popover__avatar"
                        style={{ background: p.color }}
                      >
                        {(p.name[0] ?? '?').toUpperCase()}
                      </span>
                      <span className="collab-popover__peer-name">{p.name}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="collab-popover__section">
                <button
                  type="button"
                  className="collab-popover__btn collab-popover__btn--danger"
                  onClick={() => {
                    onDisconnect();
                    setOpen(false);
                  }}
                >
                  Отключиться
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
