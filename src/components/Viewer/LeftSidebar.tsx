import { memo, useState } from 'react';
import type { FrameEntry } from './frames';
import type { ViewBox } from '../../pen/renderer/viewBox';
import { NodeTree } from './NodeTree';
import { PagesPanel } from './PagesPanel';
import { ComponentsPanel } from './ComponentsPanel';

export interface LeftSidebarProps {
  open: boolean;
  onToggle: () => void;
  onZoomToPage: (frame: FrameEntry) => void;
  onZoomToNode: (rect: ViewBox) => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  open,
  onToggle,
  onZoomToPage,
  onZoomToNode,
}: LeftSidebarProps) {
  const [tab, setTab] = useState<'layers' | 'pages' | 'components'>('layers');

  return (
    <aside className={`viewer__left-sidebar${open ? '' : ' viewer__left-sidebar--collapsed'}`}>
      {open ? (
        <>
          <div className="viewer__left-tabs" role="tablist" aria-label="Навигация">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'layers'}
              className={`viewer__left-tab${tab === 'layers' ? ' viewer__left-tab--active' : ''}`}
              onClick={() => setTab('layers')}
            >
              Layers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pages'}
              className={`viewer__left-tab${tab === 'pages' ? ' viewer__left-tab--active' : ''}`}
              onClick={() => setTab('pages')}
            >
              Pages
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'components'}
              className={`viewer__left-tab${tab === 'components' ? ' viewer__left-tab--active' : ''}`}
              onClick={() => setTab('components')}
            >
              Assets
            </button>
            <button
              type="button"
              className="viewer__left-close"
              onClick={onToggle}
              title="Свернуть панель"
              aria-label="Свернуть панель"
            >
              ×
            </button>
          </div>
          <div className="viewer__left-content">
            {tab === 'layers' && <NodeTree collapsed={false} onTogglePanel={onToggle} />}
            {tab === 'pages' && (
              <PagesPanel collapsed={false} onTogglePanel={onToggle} onZoomToPage={onZoomToPage} />
            )}
            {tab === 'components' && (
              <ComponentsPanel collapsed={false} onTogglePanel={onToggle} onZoomToNode={onZoomToNode} />
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="viewer__left-expand"
          onClick={onToggle}
          title="Показать панель слоёв"
          aria-label="Показать панель слоёв"
        >
          ☰
        </button>
      )}
    </aside>
  );
});

