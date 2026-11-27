import { useEffect, useRef, useState } from 'react';
import { useEditorSelector } from '../../pen/state/EditorContext';
import {
  detectMissingFonts,
  extractDocumentFonts,
  loadGoogleFonts,
  registerCustomFont,
  restoreSavedCustomFonts,
} from '../../utils/fontLoader';

/**
 * Automatically loads Google Fonts used in the active document,
 * restores any custom fonts saved in IndexedDB, and displays a compact
 * toolbar badge when local/brand fonts are still missing so the user can
 * upload .ttf / .otf / .woff / .woff2 files directly.
 */
export function MissingFontsBadge() {
  const rawDoc = useEditorSelector((s) => s.rawDoc);
  const [missing, setMissing] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [busyFamily, setBusyFamily] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetFamilyRef = useRef<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const families = extractDocumentFonts(rawDoc);
    (async () => {
      if (families.length === 0) {
        if (!cancelled) setMissing([]);
        return;
      }
      await restoreSavedCustomFonts();
      await loadGoogleFonts(families);
      const stillMissing = await detectMissingFonts(families);
      if (!cancelled) {
        setMissing(stillMissing);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawDoc]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const handlePickFile = (family: string) => {
    targetFamilyRef.current = family;
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const family = targetFamilyRef.current;
    if (!file || !family) return;
    setBusyFamily(family);
    setErrorMsg(null);
    try {
      const buf = await file.arrayBuffer();
      await registerCustomFont(family, buf);
      setMissing((prev) => prev.filter((f) => f !== family));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось загрузить шрифт');
    } finally {
      setBusyFamily(null);
    }
  };

  if (missing.length === 0) return null;

  return (
    <div ref={popoverRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        type="button"
        className="viewer__nav-btn"
        onClick={() => setOpen((v) => !v)}
        title={`Отсутствующие шрифты: ${missing.join(', ')}`}
        aria-label="Отсутствующие шрифты"
        style={{
          gap: 5,
          padding: '0 8px',
          width: 'auto',
          color: '#f59e0b',
          borderColor: 'rgba(245, 158, 11, 0.35)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 12 }}>Aa</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            background: 'rgba(245, 158, 11, 0.18)',
            borderRadius: 99,
            padding: '1px 5px',
          }}
        >
          {missing.length}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 300,
            background: 'var(--bg-surface, #1e1e24)',
            border: '1px solid var(--border, rgba(255,255,255,0.12))',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            padding: 12,
            zIndex: 1000,
            color: 'var(--text-primary, #f3f4f6)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Отсутствующие шрифты ({missing.length})
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 10, lineHeight: 1.4 }}>
            Google Fonts загружаются автоматически. Для локальных шрифтов выберите файл .ttf / .otf / .woff2 — он сохранится в кэше.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {missing.map((fam) => (
              <div
                key={fam}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={fam}
                >
                  {fam}
                </span>
                <button
                  type="button"
                  disabled={busyFamily === fam}
                  onClick={() => handlePickFile(fam)}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border, rgba(255,255,255,0.18))',
                    background: 'rgba(99, 102, 241, 0.18)',
                    color: 'inherit',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {busyFamily === fam ? 'Загрузка…' : 'Загрузить'}
                </button>
              </div>
            ))}
          </div>

          {errorMsg && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 8 }}>{errorMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}
