import type { PenDocument, PenNode } from '../pen/types';

/** Common OS / generic font families that should not be fetched from Google Fonts */
const SYSTEM_OR_GENERIC_FONTS = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'arial',
  'helvetica',
  'helvetica neue',
  'georgia',
  'times new roman',
  'times',
  'courier new',
  'courier',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'impact',
  'comic sans ms',
  'sf pro',
  'sf pro display',
  'sf pro text',
  'sf mono',
  'roboto',
  'material symbols outlined',
  'material symbols rounded',
  'material symbols sharp',
]);

const requestedGoogleFonts = new Set<string>();
const loadedCustomFonts = new Set<string>();

const IDB_NAME = 'openpenviewer-fonts';
const IDB_STORE = 'faces';

function normalizeFamily(raw: string): string {
  return raw.split(',')[0].replace(/^['"]|['"]$/g, '').trim();
}

/** Collect all unique non-generic font families used across a PenDocument (all pages). */
export function extractDocumentFonts(doc: PenDocument): string[] {
  const seen = new Set<string>();

  const walk = (nodes: PenNode[] | undefined) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type === 'text' && node.fontFamily) {
        const fam = normalizeFamily(node.fontFamily);
        if (fam) seen.add(fam);
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  };

  walk(doc.children);
  if (doc.pages) {
    for (const page of doc.pages) {
      walk(page.children);
    }
  }

  return Array.from(seen);
}

const GOOGLE_WEIGHT_ATTEMPTS = [':wght@100..900', ':wght@400;700', ''];

/** Inject a Google Fonts <link> per non-system family with weight fallback (one per family so 400s don't block valid fonts). */
export function loadGoogleFonts(families: string[]): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();

  const promises: Promise<void>[] = [];

  for (const fam of families) {
    const key = fam.toLowerCase();
    if (SYSTEM_OR_GENERIC_FONTS.has(key) || requestedGoogleFonts.has(key) || loadedCustomFonts.has(key)) {
      continue;
    }
    requestedGoogleFonts.add(key);

    const encoded = encodeURIComponent(fam);
    const p = new Promise<void>((resolve) => {
      let attempt = 0;
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const tryLoad = () => {
        const suffix = GOOGLE_WEIGHT_ATTEMPTS[attempt];
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encoded}${suffix}&display=swap`;
        link.dataset.penFont = fam;
        link.onload = finish;
        if (attempt < GOOGLE_WEIGHT_ATTEMPTS.length - 1) {
          link.onerror = () => {
            link.remove();
            attempt += 1;
            tryLoad();
          };
        } else {
          link.onerror = null;
          link.addEventListener('error', finish, { once: true });
        }
        document.head.appendChild(link);
      };

      tryLoad();
      // Fallback timeout so offline environments never hang
      window.setTimeout(finish, 3000);
    });
    promises.push(p);
  }

  return Promise.all(promises).then(() => undefined);
}

/** Convenience wrapper used by useDocument: extracts document fonts and loads them from Google Fonts. */
export function loadDocumentFonts(doc: PenDocument): void {
  const families = extractDocumentFonts(doc);
  if (families.length > 0) {
    void loadGoogleFonts(families);
  }
}

/** Measure whether a font family actually renders differently from fallback sans-serif/monospace. */
function isFontAvailableViaCanvas(family: string): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const sample = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩ 0123456789 ABCDEFGabcdefg';
    ctx.font = '32px monospace';
    const monoW = ctx.measureText(sample).width;
    ctx.font = '32px sans-serif';
    const sansW = ctx.measureText(sample).width;

    ctx.font = `32px "${family.replace(/"/g, '\\"')}", monospace`;
    const testMonoW = ctx.measureText(sample).width;
    ctx.font = `32px "${family.replace(/"/g, '\\"')}", sans-serif`;
    const testSansW = ctx.measureText(sample).width;

    return Math.abs(testMonoW - monoW) > 0.5 || Math.abs(testSansW - sansW) > 0.5;
  } catch {
    return true;
  }
}

/** Return font families that are neither installed locally nor loaded from Google Fonts / custom upload. */
export async function detectMissingFonts(families: string[]): Promise<string[]> {
  if (typeof document === 'undefined') return [];

  // Trigger font loading for any newly injected Google Fonts stylesheets
  if (document.fonts) {
    await Promise.allSettled(
      families.map((fam) => document.fonts.load(`400 16px "${fam.replace(/"/g, '\\"')}"`)),
    );
    await document.fonts.ready;
  }

  const missing: string[] = [];
  for (const fam of families) {
    const key = fam.toLowerCase();
    if (SYSTEM_OR_GENERIC_FONTS.has(key) || loadedCustomFonts.has(key)) continue;

    // Check FontFaceSet first, then confirm with canvas metric probe (catches OS-installed fonts)
    let available = false;
    if (document.fonts) {
      for (const face of document.fonts) {
        if (
          face.family.replace(/^['"]|['"]$/g, '').toLowerCase() === key &&
          face.status === 'loaded'
        ) {
          available = true;
          break;
        }
      }
    }
    if (!available) {
      available = isFontAvailableViaCanvas(fam);
    }
    if (!available) {
      missing.push(fam);
    }
  }
  return missing;
}

function openFontDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'family' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveFontToDb(family: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openFontDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ family, buffer });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Register a user-uploaded .ttf / .otf / .woff / .woff2 font for `family` and persist in IndexedDB. */
export async function registerCustomFont(family: string, buffer: ArrayBuffer): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  const face = new FontFace(family, buffer.slice(0));
  await face.load();
  document.fonts.add(face);
  loadedCustomFonts.add(family.toLowerCase());
  await saveFontToDb(family, buffer);
}

let restoredPromise: Promise<void> | null = null;

/** Restore all previously uploaded custom fonts from IndexedDB (runs once per session). */
export function restoreSavedCustomFonts(): Promise<void> {
  if (restoredPromise) return restoredPromise;
  restoredPromise = (async () => {
    const db = await openFontDb();
    if (!db || typeof FontFace === 'undefined' || typeof document === 'undefined') return;
    const rows = await new Promise<Array<{ family: string; buffer: ArrayBuffer }>>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => resolve((req.result as Array<{ family: string; buffer: ArrayBuffer }>) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    await Promise.allSettled(
      rows.map(async ({ family, buffer }) => {
        const face = new FontFace(family, buffer);
        await face.load();
        document.fonts.add(face);
        loadedCustomFonts.add(family.toLowerCase());
      }),
    );
  })();
  return restoredPromise;
}
