import { useState } from 'react';
import { PEER_COLORS } from '../collab/useCollab';

const LS_NAME = 'openpenviewer.collab.userName';
const LS_COLOR = 'openpenviewer.collab.color';

function readSaved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export interface CollabJoinScreenProps {
  roomId: string;
  theme: 'dark' | 'light';
  onJoin: (name: string, color: string) => void;
}

export function CollabJoinScreen({ roomId, theme, onJoin }: CollabJoinScreenProps) {
  const [name, setName] = useState(() => readSaved(LS_NAME));
  const [color, setColor] = useState(() => readSaved(LS_COLOR) || PEER_COLORS[5]);

  const trimmed = name.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onJoin(trimmed, color);
  };

  return (
    <div className={`welcome welcome--${theme}`}>
      <form className="collab-join" onSubmit={handleSubmit}>
        <div className="collab-join__head">
          <span className="welcome__logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 12L20 7.5M12 12V21M12 12L4 7.5" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
          <div>
            <h1 className="collab-join__title">Присоединиться к сессии</h1>
            <div className="collab-join__room">
              Комната <code>{roomId}</code>
            </div>
          </div>
        </div>

        <div className="collab-join__field">
          <label className="collab-join__label" htmlFor="join-user-name">
            Ваше имя
          </label>
          <input
            id="join-user-name"
            type="text"
            className="collab-join__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Введите имя..."
            maxLength={24}
            autoFocus
          />
        </div>

        <div className="collab-join__field">
          <span className="collab-join__label">Цвет аватара и курсора</span>
          <div className="collab-join__colors">
            {PEER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`collab-join__swatch${color === c ? ' collab-join__swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Выбрать цвет ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="collab-join__preview">
          <span className="collab-join__avatar" style={{ background: color }}>
            {(trimmed[0] ?? '?').toUpperCase()}
          </span>
          <span className="collab-join__preview-name">{trimmed || 'Участник'}</span>
        </div>

        <button
          type="submit"
          className="welcome__btn welcome__btn--primary collab-join__submit"
          disabled={!trimmed}
        >
          Подключиться
        </button>
      </form>
    </div>
  );
}

