export interface RecentFileEntry {
  id: string;
  name: string;
  kind: 'local' | 'sample';
  path?: string;
  sampleName?: string;
  openedAt: number;
}

const STORAGE_KEY = 'openpenviewer.recentFiles.v1';
const MAX_RECENT = 6;

export function getRecentFiles(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentFileEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (item.kind === 'local' || item.kind === 'sample') &&
        typeof item.openedAt === 'number',
    );
  } catch {
    return [];
  }
}

function saveRecentFiles(list: RecentFileEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage quota errors
  }
}

export function addRecentFile(entry: Omit<RecentFileEntry, 'openedAt'>): RecentFileEntry[] {
  const existing = getRecentFiles().filter((item) => item.id !== entry.id);
  const next: RecentFileEntry[] = [{ ...entry, openedAt: Date.now() }, ...existing].slice(
    0,
    MAX_RECENT,
  );
  saveRecentFiles(next);
  return next;
}

export function removeRecentFile(id: string): RecentFileEntry[] {
  const next = getRecentFiles().filter((item) => item.id !== id);
  saveRecentFiles(next);
  return next;
}

export function clearRecentFiles(): RecentFileEntry[] {
  saveRecentFiles([]);
  return [];
}

