/**
 * 左サイドバー: ドキュメントのノードツリーを階層表示。
 * 選択ノードをハイライトし、クリックで選択を切り替える。
 * 選択変更時に自動スクロール + 祖先を自動展開。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '../../pen/state/EditorContext';
import type { PenNode } from '../../pen/types';
import { filterNodeTree } from '../../utils/filterNodeTree';

const EYE_ON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 3C4 3 1.5 8 1.5 8S4 13 8 13 14.5 8 14.5 8 12 3 8 3Z"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
);
const EYE_OFF = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M3 3L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path
      d="M8 3C4 3 1.5 8 1.5 8S4 13 8 13 14.5 8 14.5 8"
      stroke="currentColor"
      strokeWidth="1.2"
      opacity="0.5"
    />
  </svg>
);
const LOCK_ON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <rect
      x="3"
      y="7"
      width="10"
      height="7"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="currentColor"
      fillOpacity="0.2"
    />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
);
const LOCK_OFF = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    <path d="M5 7V5a3 3 0 0 1 5-1.5" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.5" />
  </svg>
);

const TYPE_ICONS: Record<string, string> = {
  frame: 'F',
  group: 'G',
  rectangle: 'R',
  ellipse: 'E',
  line: 'L',
  polygon: 'P',
  path: 'Pa',
  text: 'T',
  icon_font: 'Ic',
  image: 'Im',
  unsupported: '?',
};

function hasChildren(node: PenNode): node is PenNode & { children: PenNode[] } {
  return 'children' in node && Array.isArray((node as { children?: unknown }).children);
}

/** 選択ノードの祖先IDセットを算出（自動展開用） */
function collectAncestorIds(nodes: PenNode[], targetId: string): Set<string> {
  const result = new Set<string>();
  function walk(node: PenNode, path: string[]): boolean {
    if (node.id === targetId) {
      for (const id of path) result.add(id);
      return true;
    }
    if (hasChildren(node)) {
      for (const child of node.children) {
        if (walk(child, [...path, node.id])) return true;
      }
    }
    return false;
  }
  for (const n of nodes) walk(n, []);
  return result;
}

interface FlatRow {
  node: PenNode;
  depth: number;
  index: number;
  parentId: string | null;
  hasKids: boolean;
  expanded: boolean;
}

const VIRTUAL_THRESHOLD = 80;
const ROW_HEIGHT = 28;
const OVERSCAN = 10;

function flattenVisibleRows(
  nodes: PenNode[],
  expandedIds: Set<string>,
  visibleIds: Set<string> | null,
  depth = 0,
  parentId: string | null = null,
  out: FlatRow[] = [],
): FlatRow[] {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (visibleIds && !visibleIds.has(node.id)) continue;
    const children = hasChildren(node) ? node.children : [];
    const hasKids = children.length > 0;
    const expanded = hasKids && expandedIds.has(node.id);
    out.push({ node, depth, index: i, parentId, hasKids, expanded });
    if (expanded) {
      flattenVisibleRows(children, expandedIds, visibleIds, depth + 1, node.id, out);
    }
  }
  return out;
}

const NodeRow = memo(function NodeRow({
  row,
  isSelected,
  isMulti,
  onSelect,
  onToggle,
  onReorder,
  onToggleVisibility,
  onToggleLock,
}: {
  row: FlatRow;
  isSelected: boolean;
  isMulti: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onReorder: (parentId: string | null, fromIdx: number, toIdx: number) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
}) {
  const { node, depth, index, parentId, hasKids, expanded } = row;
  const name = (node as { name?: string }).name ?? node.id;
  const typeIcon = TYPE_ICONS[node.type] ?? '?';
  const visible = (node as { enabled?: boolean }).enabled !== false;
  const locked = (node as { locked?: boolean }).locked === true;

  const [dropPos, setDropPos] = useState<'above' | 'below' | null>(null);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle(node.id);
    },
    [node.id, onToggle],
  );

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'application/pencil-layer',
      JSON.stringify({ parentId, fromIdx: index, nodeId: node.id }),
    );
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropPos(e.clientY < midY ? 'above' : 'below');
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = () => setDropPos(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = dropPos;
    setDropPos(null);
    const raw = e.dataTransfer.getData('application/pencil-layer');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { parentId: string | null; fromIdx: number; nodeId: string };
      if (payload.nodeId === node.id) return;
      if (payload.parentId !== parentId) return;
      const toIdx = pos === 'below' ? index + 1 : index;
      onReorder(parentId, payload.fromIdx, toIdx);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      data-node-id={node.id}
      draggable
      className={`node-tree__item ${isSelected ? 'node-tree__item--selected' : ''} ${isMulti && !isSelected ? 'node-tree__item--multi' : ''} ${dropPos ? `node-tree__item--drop-${dropPos}` : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={() => onSelect(node.id)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {hasKids ? (
        <span className="node-tree__toggle" onClick={handleToggle}>
          {expanded ? '\u25BE' : '\u25B8'}
        </span>
      ) : (
        <span className="node-tree__toggle-spacer" />
      )}
      <span className={`node-tree__type node-tree__type--${node.type}`}>{typeIcon}</span>
      <span className="node-tree__name" title={name}>
        {name}
      </span>
      <button
        type="button"
        className={`node-tree__icon-btn${!visible ? ' node-tree__icon-btn--active' : ''}`}
        title={visible ? 'Hide (Cmd+Shift+H)' : 'Show'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility(node.id);
        }}
      >
        {visible ? EYE_ON : EYE_OFF}
      </button>
      <button
        type="button"
        className={`node-tree__icon-btn${locked ? ' node-tree__icon-btn--active' : ''}`}
        title={locked ? 'Unlock (Cmd+Shift+L)' : 'Lock'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(node.id);
        }}
      >
        {locked ? LOCK_ON : LOCK_OFF}
      </button>
    </div>
  );
});

export const NodeTree = memo(function NodeTree({ collapsed, onTogglePanel }: { collapsed?: boolean; onTogglePanel?: () => void }) {
  const docChildren = useEditorSelector((s) => s.doc.children);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorSelector((s) => s.selectedNodeIds);
  const { selectNode, reorderChildren, updateNode } = useEditorActions();

  const toggleVisibility = useCallback(
    (id: string) => {
      // 対象ノードの現在値を引き直して反転
      const find = (nodes: PenNode[]): PenNode | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if ('children' in n && Array.isArray((n as { children?: PenNode[] }).children)) {
            const found = find((n as { children: PenNode[] }).children);
            if (found) return found;
          }
        }
        return null;
      };
      const node = find(docChildren);
      if (!node) return;
      const currentlyVisible = (node as { enabled?: boolean }).enabled !== false;
      updateNode(id, { enabled: !currentlyVisible } as Partial<PenNode>);
    },
    [docChildren, updateNode],
  );

  const toggleLock = useCallback(
    (id: string) => {
      const find = (nodes: PenNode[]): PenNode | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if ('children' in n && Array.isArray((n as { children?: PenNode[] }).children)) {
            const found = find((n as { children: PenNode[] }).children);
            if (found) return found;
          }
        }
        return null;
      };
      const node = find(docChildren);
      if (!node) return;
      const currentlyLocked = (node as { locked?: boolean }).locked === true;
      updateNode(id, { locked: !currentlyLocked } as Partial<PenNode>);
    },
    [docChildren, updateNode],
  );
  const listRef = useRef<HTMLDivElement>(null);

  // 展開状態の管理（トップレベルはデフォルト展開）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const n of docChildren) initial.add(n.id);
    return initial;
  });

  const onToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // -- 検索フィルタ
  const [query, setQuery] = useState('');
  const filter = useMemo(() => filterNodeTree(docChildren, query), [docChildren, query]);
  const filterActive = query.trim().length > 0;
  const visibleIds = filterActive ? filter.visible : null;

  // 自動展開はレンダー中に反映する。effect で setExpandedIds すると、
  // 畳んだままのツリーが 1 フレーム描かれてから開く (#78)。
  // 「一度開いたら以後はユーザーの操作を尊重する」という元の挙動を保つため、
  // きっかけ（フィルタ結果 / 選択ノード）が変わった瞬間だけ足し込む。
  const expandOnce = useCallback((ids: Iterable<string>) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let added = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, []);

  // フィルタ中はヒットの祖先を自動展開
  const autoExpandKey = filterActive ? Array.from(filter.autoExpand).sort().join('\u0000') : '';
  const [prevAutoExpandKey, setPrevAutoExpandKey] = useState(autoExpandKey);
  if (autoExpandKey !== prevAutoExpandKey) {
    setPrevAutoExpandKey(autoExpandKey);
    if (autoExpandKey) expandOnce(filter.autoExpand);
  }

  // 選択変更時: 祖先を自動展開
  const [prevSelectedId, setPrevSelectedId] = useState(selectedNodeId);
  if (selectedNodeId !== prevSelectedId) {
    setPrevSelectedId(selectedNodeId);
    if (selectedNodeId) {
      expandOnce(collectAncestorIds(docChildren, selectedNodeId));
    }
  }

  const flatRows = useMemo(
    () => flattenVisibleRows(docChildren, expandedIds, visibleIds),
    [docChildren, expandedIds, visibleIds],
  );

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => setViewportHeight(el.clientHeight);
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  const useVirtual = flatRows.length > VIRTUAL_THRESHOLD && viewportHeight > 0;
  const startIdx = useVirtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const endIdx = useVirtual
    ? Math.min(flatRows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : flatRows.length;
  const visibleRows = useVirtual ? flatRows.slice(startIdx, endIdx) : flatRows;

  // 選択ノードへスクロール（展開のレンダリング後に走らせる）
  useEffect(() => {
    if (!selectedNodeId) return;
    const id = selectedNodeId;
    const raf = requestAnimationFrame(() => {
      const container = listRef.current;
      if (!container) return;
      if (useVirtual) {
        const idx = flatRows.findIndex((r) => r.node.id === id);
        if (idx >= 0) {
          const top = idx * ROW_HEIGHT;
          if (top < container.scrollTop || top + ROW_HEIGHT > container.scrollTop + container.clientHeight) {
            container.scrollTop = Math.max(0, top - container.clientHeight / 2);
          }
        }
      } else {
        const el = container.querySelector(`[data-node-id="${id}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedNodeId, useVirtual, flatRows]);

  if (collapsed) {
    return (
      <div className="node-tree node-tree--collapsed">
        <button className="node-tree__toggle-btn" onClick={onTogglePanel} title="Show Layers">
          ☰
        </button>
      </div>
    );
  }

  return (
    <div className="node-tree">
      <div className="node-tree__header">
        <span>Layers</span>
        {selectedNodeIds.size > 0 && (
          <span className="node-tree__count">{selectedNodeIds.size} selected</span>
        )}
        {onTogglePanel && (
          <button className="node-tree__toggle-btn" onClick={onTogglePanel} title="Hide Layers">
            ✕
          </button>
        )}
      </div>
      <div className="node-tree__search">
        <input
          type="text"
          className="node-tree__search-input"
          placeholder="Search layers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filterActive && (
          <button
            type="button"
            className="node-tree__search-clear"
            onClick={() => setQuery('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      {filterActive && (
        <div className="node-tree__search-result">
          {filter.matchCount === 0
            ? 'No matches'
            : `${filter.matchCount} match${filter.matchCount === 1 ? '' : 'es'}`}
        </div>
      )}
      <div
        className="node-tree__list"
        ref={listRef}
        onScroll={useVirtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      >
        {useVirtual && startIdx > 0 && <div style={{ height: startIdx * ROW_HEIGHT }} />}
        {visibleRows.map((row) => (
          <NodeRow
            key={row.node.id}
            row={row}
            isSelected={selectedNodeId === row.node.id}
            isMulti={selectedNodeIds.has(row.node.id)}
            onSelect={selectNode}
            onToggle={onToggle}
            onReorder={reorderChildren}
            onToggleVisibility={toggleVisibility}
            onToggleLock={toggleLock}
          />
        ))}
        {useVirtual && endIdx < flatRows.length && (
          <div style={{ height: (flatRows.length - endIdx) * ROW_HEIGHT }} />
        )}
      </div>
    </div>
  );
});
