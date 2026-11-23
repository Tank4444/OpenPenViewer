/**
 * テスト全体の共通設定。
 *
 * Testing Library の waitFor は既定で 1 秒しか待たない。lucide の動的
 * import を待つテスト (iconFont) は、カバレッジ計測のオーバーヘッドが
 * 乗ると 1 秒に収まらないことがあり、CI が理由なく赤くなっていた。
 * 待ち時間は「遅くても通る」ための上限であって、速さの指標ではないので
 * 余裕を持たせる。正常時はこれより早く解決するのでテストは遅くならない。
 */

import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

// Node 25+ exposes a stub `localStorage` when `--localstorage-file` is not set,
// which shadows jsdom's Storage and lacks `getItem`/`setItem`/`clear`.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
