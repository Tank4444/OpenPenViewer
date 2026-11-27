/**
 * mask?: true のノードを含む子配列を SVG 上で正しくマスクして描画する。
 *
 * Figma の "Use as mask": mask ノードは自身は描画されず、後続兄弟をクリップする。
 * maskType:
 *  - 'alpha' (default): mask ノード自身の alpha チャネルで抜く
 *  - 'outline': 塗りの有無や透明度に関わらず shape の輪郭で抜く
 *  - 'luminance': 輝度で抜く
 */

import type { JSX } from 'react';
import type { PenNode } from '../types';
import { PenNodeView } from './PenNode';

export interface Segment {
  maskId?: string;
  maskNode?: PenNode;
  maskType?: 'alpha' | 'outline' | 'luminance';
  children: PenNode[];
}

function forceOpaqueOutlineMask(node: PenNode): PenNode {
  const rec = { ...(node as unknown as Record<string, unknown>) };
  rec.opacity = 1;
  delete rec.stroke;
  if (Array.isArray(rec.children) && rec.children.length > 0) {
    rec.children = (rec.children as PenNode[]).map(forceOpaqueOutlineMask);
    if (rec.fill !== undefined) {
      rec.fill = '#ffffff';
    }
  } else {
    rec.fill = '#ffffff';
  }
  return rec as unknown as PenNode;
}

export function splitByMasks(children: PenNode[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { children: [] };
  for (const c of children) {
    const isMask = (c as { mask?: boolean }).mask === true;
    if (isMask) {
      if (current.children.length > 0 || current.maskNode) segments.push(current);
      const maskType = (c as { maskType?: 'alpha' | 'outline' | 'luminance' }).maskType ?? 'alpha';
      current = {
        maskId: `mask-${c.id}`,
        maskNode: c,
        maskType,
        children: [],
      };
    } else {
      current.children.push(c);
    }
  }
  if (current.children.length > 0 || current.maskNode) segments.push(current);
  return segments;
}

export function renderMaskedChildren(children: PenNode[]): JSX.Element[] | JSX.Element {
  const segments = splitByMasks(children);
  if (segments.length === 1 && !segments[0].maskNode) {
    return children.map((c) => <PenNodeView key={c.id} node={c} />);
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.maskNode) {
          return (
            <g key={`seg-${i}`}>
              {seg.children.map((c) => <PenNodeView key={c.id} node={c} />)}
            </g>
          );
        }
        const effectiveMaskNode =
          seg.maskType === 'outline' ? forceOpaqueOutlineMask(seg.maskNode) : seg.maskNode;
        const cssMaskType = seg.maskType === 'luminance' ? 'luminance' : 'alpha';
        return (
          <g key={`seg-${i}`}>
            <defs>
              <mask
                id={seg.maskId}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                style={{ maskType: cssMaskType } as React.CSSProperties}
              >
                <g style={{ maskType: cssMaskType } as React.CSSProperties}>
                  <PenNodeView node={effectiveMaskNode} />
                </g>
              </mask>
            </defs>
            <g mask={`url(#${seg.maskId})`}>
              {seg.children.map((c) => <PenNodeView key={c.id} node={c} />)}
            </g>
          </g>
        );
      })}
    </>
  );
}
