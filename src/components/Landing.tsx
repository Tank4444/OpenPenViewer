import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { setDesktopWindowTheme } from '../platform/hostBridge';
import type { RecentFileEntry } from '../utils/recentFiles';
import type { SampleMeta } from './Loader/SampleList';

const THEME_STORAGE_KEY = 'openpenviewer.welcomeTheme';

type WelcomeTheme = 'dark' | 'light';

function readInitialTheme(): WelcomeTheme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  return 'dark';
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч назад`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'вчера';
  if (diffDay < 7) return `${diffDay} дн назад`;
  return new Date(ts).toLocaleDateString();
}

function getFileExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fig')) return 'FIG';
  if (lower.endsWith('.pen')) return 'PEN';
  return 'FILE';
}

export interface LandingProps {
  onFile: (f: File) => void;
  onUrl?: (url: string) => void;
  onSample: (name: string) => void;
  onGitHub?: () => void;
  githubConnected?: boolean;
  onOpenLocal?: () => void;
  onNewFile?: () => void;
  recentFiles?: RecentFileEntry[];
  onOpenRecent?: (entry: RecentFileEntry) => void;
  onRemoveRecent?: (id: string) => void;
  onClearRecent?: () => void;
  theme?: WelcomeTheme;
  onToggleTheme?: () => void;
}

export function Landing({
  onFile,
  onSample,
  onOpenLocal,
  onNewFile,
  recentFiles = [],
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
  theme: controlledTheme,
  onToggleTheme,
}: LandingProps) {
  const [localTheme, setLocalTheme] = useState<WelcomeTheme>(readInitialTheme);
  const theme = controlledTheme ?? localTheme;
  const [samples, setSamples] = useState<SampleMeta[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (controlledTheme) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, localTheme);
    } catch {
      // ignore
    }
    void setDesktopWindowTheme(localTheme);
  }, [controlledTheme, localTheme]);

  const handleToggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
    } else {
      setLocalTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}samples/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setSamples(Array.isArray(data) ? (data as SampleMeta[]) : []);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) {
        onFile(accepted[0]);
      }
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    noClick: true,
    accept: {
      'application/json': ['.pen', '.json'],
      'application/octet-stream': ['.fig'],
    },
  });

  const handleOpenClick = () => {
    if (onOpenLocal) {
      onOpenLocal();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className={`welcome welcome--${theme}`} {...getRootProps()}>
      <input {...getInputProps()} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pen,.fig,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />

      <div className="welcome__shell">
        <div className="welcome__top">
          <div className="welcome__brand">
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
            <div className="welcome__brand-text">
              <div className="welcome__brand-row">
                <h1 className="welcome__title">OpenPenViewer</h1>
                <span className="welcome__version">v{__APP_VERSION__}</span>
              </div>
              <p className="welcome__subtitle">Просмотр, редактирование и экспорт макетов .pen и .fig</p>
            </div>
          </div>

          <button
            type="button"
            className="welcome__theme-btn"
            onClick={handleToggleTheme}
            title={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
            aria-label="Переключить тему"
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            <span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
          </button>
        </div>

        <div className="welcome__grid">
          <section className="welcome__primary">
            <div
              className={`welcome__dropzone${isDragActive ? ' welcome__dropzone--active' : ''}`}
              onClick={handleOpenClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenClick();
                }
              }}
            >
              <div className="welcome__drop-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="welcome__drop-title">
                {isDragActive ? 'Отпустите файл для открытия' : 'Перетащите файл сюда'}
              </div>
              <div className="welcome__drop-hint">или нажмите, чтобы выбрать с диска</div>
              <div className="welcome__badges">
                <span className="welcome__badge">.pen</span>
                <span className="welcome__badge">.fig</span>
              </div>
            </div>

            <div className="welcome__actions">
              <button type="button" className="welcome__btn welcome__btn--primary" onClick={handleOpenClick}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>Открыть файл</span>
              </button>

              {onNewFile && (
                <button type="button" className="welcome__btn welcome__btn--secondary" onClick={onNewFile}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Создать новый</span>
                </button>
              )}
            </div>
          </section>

          <section className="welcome__secondary">
            <div className="welcome__panel">
              <div className="welcome__panel-head">
                <h2 className="welcome__panel-title">Недавние файлы</h2>
                {recentFiles.length > 0 && onClearRecent && (
                  <button type="button" className="welcome__text-btn" onClick={onClearRecent}>
                    Очистить
                  </button>
                )}
              </div>

              {recentFiles.length === 0 ? (
                <div className="welcome__empty">
                  Недавние файлы появятся здесь после первого открытия
                </div>
              ) : (
                <ul className="welcome__recent-list">
                  {recentFiles.map((entry) => {
                    const ext = entry.kind === 'sample' ? 'SAMPLE' : getFileExt(entry.name);
                    return (
                      <li key={entry.id} className="welcome__recent-item">
                        <button
                          type="button"
                          className="welcome__recent-btn"
                          onClick={() => onOpenRecent?.(entry)}
                          title={entry.path ?? entry.name}
                        >
                          <span className={`welcome__ext welcome__ext--${ext.toLowerCase()}`}>
                            {ext}
                          </span>
                          <span className="welcome__recent-info">
                            <span className="welcome__recent-name">{entry.name}</span>
                            <span className="welcome__recent-meta">
                              {entry.path ? entry.path : 'Встроенный пример'}
                            </span>
                          </span>
                          <span className="welcome__recent-time">
                            {formatRelativeTime(entry.openedAt)}
                          </span>
                        </button>
                        {onRemoveRecent && (
                          <button
                            type="button"
                            className="welcome__recent-remove"
                            onClick={() => onRemoveRecent(entry.id)}
                            title="Убрать из списка"
                            aria-label={`Убрать ${entry.name}`}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {samples.length > 0 && (
              <div className="welcome__panel">
                <div className="welcome__panel-head">
                  <h2 className="welcome__panel-title">Примеры</h2>
                </div>
                <div className="welcome__samples">
                  {samples.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      className="welcome__sample-card"
                      onClick={() => onSample(s.name)}
                    >
                      <span className="welcome__sample-name">{s.label}</span>
                      {s.description && (
                        <span className="welcome__sample-desc">{s.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
