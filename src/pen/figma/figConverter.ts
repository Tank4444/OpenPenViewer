import type {
  Effect,
  Fill,
  PenDocument,
  PenNode,
  Stroke,
} from '../types';
import {
  buildFigFile,
  parseFigFile,
  type FigColor,
  type FigEffect,
  type FigGuid,
  type FigNodeChange,
  type FigPaint,
} from './figKiwi';

function guidKey(g?: FigGuid): string {
  if (!g) return '0:0';
  return `${g.sessionID}:${g.localID}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toByteHex(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function figColorToHex(c?: FigColor): string {
  if (!c) return '#000000';
  const r = toByteHex(c.r ?? 0);
  const g = toByteHex(c.g ?? 0);
  const b = toByteHex(c.b ?? 0);
  const a = clamp01(c.a ?? 1);
  if (a < 0.999) {
    return `#${r}${g}${b}${toByteHex(a)}`;
  }
  return `#${r}${g}${b}`;
}

export function hexToFigColor(colorStr: string | undefined, opacityOverride?: number): FigColor {
  const fallback: FigColor = { r: 0, g: 0, b: 0, a: opacityOverride ?? 1 };
  if (!colorStr || typeof colorStr !== 'string') return fallback;
  const s = colorStr.trim();

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return { r, g, b, a: opacityOverride ?? a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a: opacityOverride ?? a };
    }
  }

  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return {
      r: clamp01(Number(rgba[1]) / 255),
      g: clamp01(Number(rgba[2]) / 255),
      b: clamp01(Number(rgba[3]) / 255),
      a: opacityOverride ?? (rgba[4] !== undefined ? clamp01(Number(rgba[4])) : 1),
    };
  }

  return fallback;
}

function figPaintsToPenFills(paints?: FigPaint[]): Fill[] | undefined {
  if (!paints || paints.length === 0) return undefined;
  const out: Fill[] = [];
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === 'SOLID' || !p.type) {
      out.push({
        type: 'color',
        color: figColorToHex(p.color),
        ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
      });
    } else if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_ANGULAR') {
      const gradientType =
        p.type === 'GRADIENT_RADIAL'
          ? 'radial'
          : p.type === 'GRADIENT_ANGULAR'
            ? 'angular'
            : 'linear';
      out.push({
        type: 'gradient',
        gradientType,
        colors: (p.stops ?? []).map((st) => ({
          color: figColorToHex(st.color),
          position: st.position,
        })),
        ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function penFillsToFigPaints(fills: unknown): FigPaint[] | undefined {
  if (!fills) return undefined;
  const list = Array.isArray(fills) ? fills : [fills];
  const out: FigPaint[] = [];

  for (const item of list) {
    if (typeof item === 'string') {
      out.push({
        type: 'SOLID',
        color: hexToFigColor(item),
        opacity: 1,
        visible: true,
      });
    } else if (item && typeof item === 'object') {
      const f = item as Partial<Fill> & { type?: string; color?: string; colors?: Array<{ color: string; position: number }>; gradientType?: string; opacity?: number; enabled?: boolean };
      if (f.enabled === false) continue;
      if (f.type === 'color' && f.color) {
        out.push({
          type: 'SOLID',
          color: hexToFigColor(f.color),
          opacity: f.opacity ?? 1,
          visible: true,
        });
      } else if (f.type === 'gradient' && Array.isArray(f.colors)) {
        const type =
          f.gradientType === 'radial'
            ? 'GRADIENT_RADIAL'
            : f.gradientType === 'angular'
              ? 'GRADIENT_ANGULAR'
              : 'GRADIENT_LINEAR';
        out.push({
          type,
          opacity: f.opacity ?? 1,
          visible: true,
          stops: f.colors.map((c) => ({
            color: hexToFigColor(c.color),
            position: c.position,
          })),
        });
      }
    }
  }

  return out.length > 0 ? out : undefined;
}

function figEffectsToPen(effects?: FigEffect[]): Effect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  const out: Effect[] = [];
  for (const e of effects) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      out.push({
        type: 'shadow',
        shadowType: e.type === 'INNER_SHADOW' ? 'inner' : 'outer',
        color: figColorToHex(e.color),
        offset: { x: e.offset?.x ?? 0, y: e.offset?.y ?? 4 },
        blur: e.radius ?? 8,
        spread: e.spread ?? 0,
      });
    } else if (e.type === 'FOREGROUND_BLUR' || e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      out.push({
        type: 'blur',
        radius: e.radius ?? 8,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function penEffectsToFig(effects: unknown): FigEffect[] | undefined {
  if (!effects) return undefined;
  const list = Array.isArray(effects) ? effects : [effects];
  const out: FigEffect[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Effect & { enabled?: boolean };
    if (e.enabled === false) continue;
    if (e.type === 'shadow') {
      out.push({
        type: e.shadowType === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: hexToFigColor(e.color ?? '#00000040'),
        offset: { x: e.offset?.x ?? 0, y: e.offset?.y ?? 4 },
        radius: e.blur ?? 8,
        spread: e.spread ?? 0,
        visible: true,
      });
    } else if (e.type === 'blur') {
      out.push({
        type: 'FOREGROUND_BLUR',
        radius: e.radius ?? 8,
        visible: true,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function mapStackAlign(v?: string): 'start' | 'center' | 'end' | 'space_between' | undefined {
  switch (v) {
    case 'MIN':
      return 'start';
    case 'CENTER':
      return 'center';
    case 'MAX':
      return 'end';
    case 'SPACE_BETWEEN':
    case 'SPACE_EVENLY':
      return 'space_between';
    default:
      return undefined;
  }
}

function mapPenAlignToFig(v?: string): string | undefined {
  switch (v) {
    case 'start':
      return 'MIN';
    case 'center':
      return 'CENTER';
    case 'end':
      return 'MAX';
    case 'space_between':
    case 'space_around':
      return 'SPACE_BETWEEN';
    default:
      return undefined;
  }
}

function convertFigNodeToPen(
  nc: FigNodeChange,
  childrenMap: Map<string, FigNodeChange[]>,
): PenNode | null {
  const id = guidKey(nc.guid);
  const x = nc.transform?.m02 ?? 0;
  const y = nc.transform?.m12 ?? 0;
  const width = nc.size?.x ?? 0;
  const height = nc.size?.y ?? 0;
  const fills = figPaintsToPenFills(nc.fillPaints);
  const strokeFills = figPaintsToPenFills(nc.strokePaints);
  const stroke: Stroke | undefined = strokeFills
    ? {
        fill: strokeFills,
        thickness: nc.strokeWeight ?? 1,
        align:
          nc.strokeAlign === 'INSIDE'
            ? 'inside'
            : nc.strokeAlign === 'OUTSIDE'
              ? 'outside'
              : 'center',
      }
    : undefined;
  const effects = figEffectsToPen(nc.effects);

  const base = {
    id,
    name: nc.name,
    x,
    y,
    ...(nc.visible === false ? { enabled: false } : {}),
    ...(nc.opacity !== undefined && nc.opacity < 1 ? { opacity: nc.opacity } : {}),
  };

  const childNodes = (childrenMap.get(id) ?? [])
    .map((child) => convertFigNodeToPen(child, childrenMap))
    .filter((n): n is PenNode => n !== null);

  switch (nc.type) {
    case 'FRAME':
    case 'COMPONENT':
    case 'SYMBOL':
    case 'INSTANCE': {
      const layout =
        nc.stackMode === 'HORIZONTAL'
          ? 'horizontal'
          : nc.stackMode === 'VERTICAL'
            ? 'vertical'
            : undefined;
      const padH = nc.stackHorizontalPadding ?? nc.stackPadding ?? 0;
      const padV = nc.stackVerticalPadding ?? nc.stackPadding ?? 0;
      const padding = padH || padV ? [padV, padH] : undefined;
      return {
        ...base,
        type: 'frame',
        width,
        height,
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
        ...(nc.cornerRadius ? { cornerRadius: nc.cornerRadius } : {}),
        ...(nc.clipsContent !== undefined ? { clip: nc.clipsContent } : {}),
        ...(layout ? { layout } : {}),
        ...(nc.stackSpacing ? { gap: nc.stackSpacing } : {}),
        ...(padding ? { padding } : {}),
        ...(mapStackAlign(nc.stackPrimaryAlignItems)
          ? { justifyContent: mapStackAlign(nc.stackPrimaryAlignItems) }
          : {}),
        ...(mapStackAlign(nc.stackCounterAlignItems)
          ? { alignItems: mapStackAlign(nc.stackCounterAlignItems) }
          : {}),
        children: childNodes,
      } as PenNode;
    }

    case 'GROUP':
    case 'BOOLEAN_OPERATION':
      return {
        ...base,
        type: 'group',
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        children: childNodes,
      } as PenNode;

    case 'ELLIPSE':
      return {
        ...base,
        type: 'ellipse',
        width,
        height,
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;

    case 'LINE':
      return {
        ...base,
        type: 'line',
        width,
        height,
        ...(stroke ? { stroke } : {}),
      } as PenNode;

    case 'REGULAR_POLYGON':
    case 'STAR':
      return {
        ...base,
        type: 'polygon',
        width,
        height,
        polygonCount: nc.count ?? 3,
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;

    case 'TEXT': {
      const textFill = fills?.[0];
      return {
        ...base,
        type: 'text',
        width,
        height,
        content: nc.textData?.characters ?? nc.name ?? '',
        fontSize: nc.fontSize ?? 16,
        ...(nc.fontName?.family ? { fontFamily: nc.fontName.family } : {}),
        ...(nc.textAlignHorizontal
          ? { textAlign: nc.textAlignHorizontal.toLowerCase() }
          : {}),
        ...(textFill ? { fill: textFill } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
    }

    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
    case 'VECTOR':
    default:
      return {
        ...base,
        type: 'rectangle',
        width,
        height,
        ...(nc.cornerRadius ? { cornerRadius: nc.cornerRadius } : {}),
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
  }
}

export function figToPen(input: ArrayBuffer | Uint8Array): PenDocument {
  const parsed = parseFigFile(input);
  const nodeChanges = (parsed.message.nodeChanges ?? []).filter(
    (nc) => nc.phase !== 'REMOVED',
  );

  const byId = new Map<string, FigNodeChange>();
  const childrenMap = new Map<string, FigNodeChange[]>();

  for (const nc of nodeChanges) {
    byId.set(guidKey(nc.guid), nc);
  }

  for (const nc of nodeChanges) {
    const pKey = nc.parentIndex?.guid ? guidKey(nc.parentIndex.guid) : '';
    if (!pKey || pKey === guidKey(nc.guid)) continue;
    const arr = childrenMap.get(pKey) ?? [];
    arr.push(nc);
    childrenMap.set(pKey, arr);
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) =>
      (a.parentIndex?.position ?? '').localeCompare(b.parentIndex?.position ?? ''),
    );
  }

  const canvases = nodeChanges.filter((nc) => nc.type === 'CANVAS');
  const rootNodes: PenNode[] = [];

  if (canvases.length > 0) {
    const firstCanvas = canvases[0];
    const topNodes = childrenMap.get(guidKey(firstCanvas.guid)) ?? [];
    for (const nc of topNodes) {
      const converted = convertFigNodeToPen(nc, childrenMap);
      if (converted) rootNodes.push(converted);
    }
  } else {
    // Fallback: nodes without a known parent
    for (const nc of nodeChanges) {
      if (nc.type === 'DOCUMENT') continue;
      const pKey = nc.parentIndex?.guid ? guidKey(nc.parentIndex.guid) : '';
      if (!pKey || !byId.has(pKey)) {
        const converted = convertFigNodeToPen(nc, childrenMap);
        if (converted) rootNodes.push(converted);
      }
    }
  }

  return {
    version: '1.0',
    children: rootNodes,
  };
}

function positionForIndex(index: number): string {
  // Printable ASCII lexicographical positions (!, ", #, $, ...)
  const code = 33 + (index % 90);
  const prefix = index >= 90 ? 'z'.repeat(Math.floor(index / 90)) : '';
  return prefix + String.fromCharCode(code);
}

export function penToFig(doc: PenDocument, title = 'OpenPenViewer'): Uint8Array {
  let nextLocalId = 1;
  const allocGuid = (sessionID = 1): FigGuid => ({ sessionID, localID: nextLocalId++ });

  const docGuid: FigGuid = { sessionID: 0, localID: 0 };
  const canvasGuid: FigGuid = { sessionID: 0, localID: 1 };

  const changes: FigNodeChange[] = [
    {
      guid: docGuid,
      phase: 'CREATED',
      type: 'DOCUMENT',
      name: 'Document',
      visible: true,
      opacity: 1,
    },
    {
      guid: canvasGuid,
      phase: 'CREATED',
      parentIndex: { guid: docGuid, position: '!' },
      type: 'CANVAS',
      name: 'Page 1',
      visible: true,
      opacity: 1,
    },
  ];

  const visit = (nodes: PenNode[], parentGuid: FigGuid) => {
    nodes.forEach((node, idx) => {
      const guid = allocGuid();
      const x = typeof node.x === 'number' ? node.x : 0;
      const y = typeof node.y === 'number' ? node.y : 0;
      const w = typeof (node as { width?: unknown }).width === 'number' ? (node as { width: number }).width : 100;
      const h = typeof (node as { height?: unknown }).height === 'number' ? (node as { height: number }).height : 100;

      const fillRaw = (node as { fill?: unknown }).fill;
      const strokeRaw = (node as { stroke?: Stroke }).stroke;
      const effectRaw = (node as { effect?: unknown }).effect;

      const fillPaints = penFillsToFigPaints(fillRaw);
      const strokePaints = strokeRaw?.fill ? penFillsToFigPaints(strokeRaw.fill) : undefined;
      const strokeWeight = typeof strokeRaw?.thickness === 'number' ? strokeRaw.thickness : strokeRaw ? 1 : undefined;
      const effects = penEffectsToFig(effectRaw);

      let figType = 'RECTANGLE';
      if (node.type === 'frame') figType = 'FRAME';
      else if (node.type === 'group') figType = 'GROUP';
      else if (node.type === 'ellipse') figType = 'ELLIPSE';
      else if (node.type === 'line') figType = 'LINE';
      else if (node.type === 'polygon') figType = 'REGULAR_POLYGON';
      else if (node.type === 'text') figType = 'TEXT';
      else if (node.type === 'path') figType = 'VECTOR';

      const nc: FigNodeChange = {
        guid,
        phase: 'CREATED',
        parentIndex: { guid: parentGuid, position: positionForIndex(idx) },
        type: figType,
        name: node.name ?? node.id,
        visible: (node as { enabled?: boolean }).enabled !== false,
        opacity: (node as { opacity?: number }).opacity ?? 1,
        size: { x: w, y: h },
        transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y },
        ...(fillPaints ? { fillPaints } : {}),
        ...(strokePaints ? { strokePaints } : {}),
        ...(strokeWeight !== undefined ? { strokeWeight } : {}),
        ...(strokeRaw?.align ? { strokeAlign: strokeRaw.align.toUpperCase() } : {}),
        ...(effects ? { effects } : {}),
      };

      const cornerRadius = (node as { cornerRadius?: number | number[] }).cornerRadius;
      if (typeof cornerRadius === 'number') {
        nc.cornerRadius = cornerRadius;
      } else if (Array.isArray(cornerRadius) && typeof cornerRadius[0] === 'number') {
        nc.cornerRadius = cornerRadius[0];
      }

      if (node.type === 'frame') {
        nc.clipsContent = node.clip !== false;
        if (node.layout === 'horizontal') nc.stackMode = 'HORIZONTAL';
        else if (node.layout === 'vertical') nc.stackMode = 'VERTICAL';
        if (typeof node.gap === 'number') nc.stackSpacing = node.gap;
        if (typeof node.padding === 'number') {
          nc.stackHorizontalPadding = node.padding;
          nc.stackVerticalPadding = node.padding;
        } else if (Array.isArray(node.padding)) {
          nc.stackVerticalPadding = node.padding[0] ?? 0;
          nc.stackHorizontalPadding = node.padding[1] ?? node.padding[0] ?? 0;
        }
        const primary = mapPenAlignToFig(node.justifyContent);
        const counter = mapPenAlignToFig(node.alignItems);
        if (primary) nc.stackPrimaryAlignItems = primary;
        if (counter) nc.stackCounterAlignItems = counter;
      }

      if (node.type === 'text') {
        nc.textData = { characters: node.content ?? '' };
        nc.fontSize = typeof node.fontSize === 'number' ? node.fontSize : 16;
        nc.fontName = {
          family: node.fontFamily ?? 'Inter',
          style: 'Regular',
          postscript: '',
        };
        if (node.textAlign) {
          nc.textAlignHorizontal = node.textAlign.toUpperCase();
        }
      }

      if (node.type === 'polygon' && typeof node.polygonCount === 'number') {
        nc.count = node.polygonCount;
      }

      changes.push(nc);

      const children = (node as { children?: PenNode[] }).children;
      if (Array.isArray(children) && children.length > 0) {
        visit(children, guid);
      }
    });
  };

  visit(doc.children, canvasGuid);
  return buildFigFile(changes, title);
}

