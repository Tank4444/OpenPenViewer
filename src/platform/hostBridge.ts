/**
 * Host platform bridge for Web, Tauri Desktop, and Android Studio IDE (JCEF).
 * Keeps web behavior unchanged while enabling native local file I/O in desktop/IDE.
 */

export type HostKind = 'tauri' | 'ide' | 'web';

export interface IdeHostBridge {
  getInitialFile?: () => { name: string; content: string } | null;
  saveContent?: (content: string) => void;
  onContentUpdate?: (cb: (payload: { name: string; content: string }) => void) => () => void;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __OPEN_PEN_IDE__?: IdeHostBridge;
  }
}

export function getHostKind(): HostKind {
  if (typeof window === 'undefined') return 'web';
  if ('__TAURI_INTERNALS__' in window) return 'tauri';
  if (window.__OPEN_PEN_IDE__) return 'ide';
  return 'web';
}

export function isTauriHost(): boolean {
  return getHostKind() === 'tauri';
}

export function isIdeHost(): boolean {
  return getHostKind() === 'ide';
}

let activeLocalPath: string | null = null;
const pathListeners = new Set<(path: string | null) => void>();
const saveListeners = new Set<(name: string) => void>();

export function getActiveLocalPath(): string | null {
  return activeLocalPath;
}

export function setActiveLocalPath(path: string | null): void {
  activeLocalPath = path;
  for (const listener of pathListeners) {
    listener(path);
  }
}

export function subscribeActiveLocalPath(listener: (path: string | null) => void): () => void {
  pathListeners.add(listener);
  return () => {
    pathListeners.delete(listener);
  };
}

export function subscribeSaveEvents(listener: (name: string) => void): () => void {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

function notifySaved(name: string): void {
  for (const listener of saveListeners) {
    listener(name);
  }
}

export function extractFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getLaunchFile(): Promise<string | null> {
  if (!isTauriHost()) return null;
  try {
    return await tauriInvoke<string | null>('get_launch_file');
  } catch {
    return null;
  }
}

export interface LocalFileResult {
  path: string;
  name: string;
  text?: string;
  bytes?: Uint8Array;
}

export async function readLocalFile(path: string): Promise<LocalFileResult> {
  const name = extractFileName(path);
  if (path.toLowerCase().endsWith('.fig')) {
    const raw = await tauriInvoke<number[]>('read_binary_file', { path });
    return { path, name, bytes: new Uint8Array(raw) };
  }
  const text = await tauriInvoke<string>('read_pen_file', { path });
  return { path, name, text };
}

export async function openLocalFileDialog(): Promise<LocalFileResult | null> {
  if (!isTauriHost()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    filters: [
      { name: 'Design Files (.pen, .fig)', extensions: ['pen', 'json', 'fig'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!selected || typeof selected !== 'string') return null;
  return readLocalFile(selected);
}

export async function watchLocalFile(path: string | null): Promise<void> {
  if (!isTauriHost()) return;
  try {
    await tauriInvoke('watch_pen_file', { path });
  } catch (err) {
    console.warn('Failed to watch file:', err);
  }
}

export async function onLocalFileChanged(cb: (path: string) => void): Promise<() => void> {
  if (!isTauriHost()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ path: string }>('pen-file-changed', (event) => {
    if (event.payload?.path) {
      cb(event.payload.path);
    }
  });
}

export async function onLocalFileOpenRequest(cb: (path: string) => void): Promise<() => void> {
  if (!isTauriHost()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ path: string }>('pen-file-open-request', (event) => {
    if (event.payload?.path) {
      cb(event.payload.path);
    }
  });
}

export interface SaveResult {
  saved: boolean;
  path?: string;
  name?: string;
}

export async function savePenContent(
  json: string,
  suggestedName?: string,
  forceSaveAs = false,
): Promise<SaveResult> {
  const host = getHostKind();

  if (host === 'ide') {
    window.__OPEN_PEN_IDE__?.saveContent?.(json);
    notifySaved(suggestedName ?? 'document.pen');
    return { saved: true, name: suggestedName };
  }

  if (host === 'tauri') {
    let targetPath = forceSaveAs ? null : activeLocalPath;
    if (!targetPath) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const picked = await save({
        defaultPath: suggestedName ?? 'design.pen',
        filters: [{ name: 'Pencil Design', extensions: ['pen', 'json'] }],
      });
      if (!picked) {
        return { saved: false };
      }
      targetPath = picked;
    }

    await tauriInvoke('write_pen_file', { path: targetPath, content: json });
    setActiveLocalPath(targetPath);
    await watchLocalFile(targetPath);
    const savedName = extractFileName(targetPath);
    notifySaved(savedName);
    return { saved: true, path: targetPath, name: savedName };
  }

  // Default Web download behavior
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName ?? 'exported.pen';
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, name: a.download };
}

export async function saveBinaryFile(
  bytes: Uint8Array,
  suggestedName: string,
  filterName: string,
  extensions: string[],
): Promise<SaveResult> {
  if (isTauriHost()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const picked = await save({
      defaultPath: suggestedName,
      filters: [{ name: filterName, extensions }],
    });
    if (!picked) return { saved: false };
    await tauriInvoke('write_binary_file', { path: picked, data: Array.from(bytes) });
    const savedName = extractFileName(picked);
    notifySaved(savedName);
    return { saved: true, path: picked, name: savedName };
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, name: suggestedName };
}
