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
  type FigBlob,
  type FigColor,
  type FigEffect,
  type FigGuid,
  type FigNodeChange,
  type FigPaint,
} from './figKiwi';
import { lookupLucideIcon } from '../renderer/lucideIcons';
import {
  lucideToVectorNetworkBlob,
  svgPathToVectorNetworkBlob,
  vectorNetworkBlobToSvgPath,
} from './vectorNetwork';

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

function mapStackAlign(v?: string): 'start' | 'center' | 'end' | 'space_between' | 'space_around' | undefined {
  switch (v) {
    case 'MIN':
      return 'start';
    case 'CENTER':
      return 'center';
    case 'MAX':
      return 'end';
    case 'SPACE_BETWEEN':
      return 'space_between';
    case 'SPACE_EVENLY':
      return 'space_around';
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
      return 'SPACE_BETWEEN';
    case 'space_around':
      return 'SPACE_EVENLY';
    default:
      return undefined;
  }
}

function mapTextAlignToFig(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  switch (v.toLowerCase()) {
    case 'left':
    case 'start':
      return 'LEFT';
    case 'center':
      return 'CENTER';
    case 'right':
    case 'end':
      return 'RIGHT';
    case 'justify':
    case 'justified':
      return 'JUSTIFIED';
    default:
      return undefined;
  }
}

function mapStrokeAlignToFig(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  switch (v.toLowerCase()) {
    case 'center':
      return 'CENTER';
    case 'inside':
    case 'inner':
      return 'INSIDE';
    case 'outside':
    case 'outer':
      return 'OUTSIDE';
    default:
      return undefined;
  }
}

function mapFigFontStyleToWeight(style?: string): string | undefined {
  if (!style) return undefined;
  const s = style.trim().toLowerCase();
  if (s.includes('bold') && s.includes('semi')) return '600';
  if (s.includes('bold') || s.includes('black') || s.includes('heavy')) return '700';
  if (s.includes('medium')) return '500';
  if (s.includes('light')) return '300';
  return undefined;
}

function mapFontStyle(weight: unknown): string {
  if (typeof weight === 'number') {
    if (weight >= 700) return 'Bold';
    if (weight >= 600) return 'Semi Bold';
    if (weight >= 500) return 'Medium';
    if (weight <= 300) return 'Light';
    return 'Regular';
  }
  if (typeof weight === 'string') {
    const w = weight.trim().toLowerCase();
    if (w === 'bold' || w === '700' || w === '800' || w === '900') return 'Bold';
    if (w === 'semibold' || w === 'semi-bold' || w === '600') return 'Semi Bold';
    if (w === 'medium' || w === '500') return 'Medium';
    if (w === 'light' || w === '300') return 'Light';
  }
  return 'Regular';
}

const MATERIAL_TO_LUCIDE: Record<string, string> = {
  shopping_bag: 'shopping-bag',
  local_mall: 'shopping-bag',
  shopping_cart: 'shopping-cart',
  search: 'search',
  star: 'star',
  star_rate: 'star',
  favorite: 'heart',
  favorite_border: 'heart',
  add: 'plus',
  remove: 'minus',
  tune: 'sliders-horizontal',
  swap_vert: 'arrow-up-down',
  wifi: 'wifi',
  signal_cellular_alt: 'signal',
  signal_cellular_4_bar: 'signal',
  signal_cellular_3_bar: 'signal',
  signal_cellular_2_bar: 'signal',
  signal_cellular_1_bar: 'signal',
  network_cell: 'signal',
  battery_full: 'battery-full',
  battery_std: 'battery-full',
  battery_5_bar: 'battery-full',
  battery_6_bar: 'battery-full',
  battery_charging_full: 'battery-charging',
  person: 'user',
  account_circle: 'circle-user',
  lock: 'lock',
  visibility: 'eye',
  visibility_off: 'eye-off',
  mail: 'mail',
  email: 'mail',
  info: 'info',
  home: 'home',
  settings: 'settings',
  arrow_back: 'arrow-left',
  arrow_forward: 'arrow-right',
  close: 'x',
  check: 'check',
  delete: 'trash-2',
  delete_outline: 'trash-2',
  delete_forever: 'trash-2',
  edit: 'pencil',
  notifications: 'bell',
  menu: 'menu',
  more_vert: 'more-vertical',
  more_horiz: 'more-horizontal',
  filter_list: 'list-filter',
  bookmark: 'bookmark',
  share: 'share-2',
  chevron_right: 'chevron-right',
  chevron_left: 'chevron-left',
  expand_more: 'chevron-down',
  expand_less: 'chevron-up',
  location_on: 'map-pin',
  phone: 'phone',
  credit_card: 'credit-card',
  local_shipping: 'truck',
  verified: 'badge-check',
  verified_user: 'shield-check',
  storefront: 'store',
  alternate_email: 'at-sign',
  replay: 'rotate-ccw',
  logout: 'log-out',
  login: 'log-in',
};

function safeNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function safeTextContent(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'content' in part) {
          return String((part as { content?: unknown }).content ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

function convertFigNodeToPen(
  nc: FigNodeChange,
  childrenMap: Map<string, FigNodeChange[]>,
  blobs: FigBlob[] = [],
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
    ...(nc.stackPositioning === 'ABSOLUTE' ? { layoutPosition: 'absolute' as const } : {}),
  };

  const childNodes = (childrenMap.get(id) ?? [])
    .map((child) => convertFigNodeToPen(child, childrenMap, blobs))
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
            : 'none';
      const padLeft = nc.stackHorizontalPadding ?? nc.stackPadding ?? 0;
      const padTop = nc.stackVerticalPadding ?? nc.stackPadding ?? 0;
      const padRight = nc.stackPaddingRight ?? padLeft;
      const padBottom = nc.stackPaddingBottom ?? padTop;
      const padding =
        padTop || padRight || padBottom || padLeft
          ? padTop !== padBottom || padLeft !== padRight
            ? [padTop, padRight, padBottom, padLeft]
            : [padTop, padLeft]
          : undefined;
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
        layout,
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
      const weight = mapFigFontStyleToWeight(nc.fontName?.style);
      return {
        ...base,
        type: 'text',
        width,
        height,
        content: nc.textData?.characters ?? nc.name ?? '',
        fontSize: nc.fontSize ?? 16,
        ...(nc.fontName?.family ? { fontFamily: nc.fontName.family } : {}),
        ...(weight ? { fontWeight: weight } : {}),
        ...(nc.textAlignHorizontal
          ? { textAlign: nc.textAlignHorizontal.toLowerCase() }
          : {}),
        ...(textFill ? { fill: textFill } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
    }

    case 'VECTOR': {
      const blobIdx = nc.vectorData?.vectorNetworkBlob;
      const blob = typeof blobIdx === 'number' ? blobs[blobIdx] : undefined;
      const geometry = blob?.bytes ? vectorNetworkBlobToSvgPath(blob.bytes) : '';
      if (geometry) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry,
          ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
          ...(stroke ? { stroke } : {}),
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }
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

    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
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
  const blobs = Array.isArray(parsed.message.blobs) ? (parsed.message.blobs as FigBlob[]) : [];
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
    list.sort((a, b) => {
      const pa = a.parentIndex?.position ?? '';
      const pb = b.parentIndex?.position ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }

  const canvases = nodeChanges.filter((nc) => nc.type === 'CANVAS');
  const rootNodes: PenNode[] = [];

  if (canvases.length > 0) {
    const firstCanvas = canvases[0];
    const topNodes = childrenMap.get(guidKey(firstCanvas.guid)) ?? [];
    for (const nc of topNodes) {
      const converted = convertFigNodeToPen(nc, childrenMap, blobs);
      if (converted) rootNodes.push(converted);
    }
  } else {
    // Fallback: nodes without a known parent
    for (const nc of nodeChanges) {
      if (nc.type === 'DOCUMENT') continue;
      const pKey = nc.parentIndex?.guid ? guidKey(nc.parentIndex.guid) : '';
      if (!pKey || !byId.has(pKey)) {
        const converted = convertFigNodeToPen(nc, childrenMap, blobs);
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
  return String(index).padStart(5, '0');
}

export function penToFig(doc: PenDocument, title = 'OpenPenViewer'): Uint8Array {
  let nextLocalId = 1;
  const allocGuid = (sessionID = 1): FigGuid => ({ sessionID, localID: nextLocalId++ });

  const docGuid: FigGuid = { sessionID: 0, localID: 0 };
  const canvasGuid: FigGuid = { sessionID: 0, localID: 1 };
  const blobs: FigBlob[] = [];
  const pushBlob = (bytes: Uint8Array): number => {
    blobs.push({ bytes });
    return blobs.length - 1;
  };

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
      const x = safeNum(node.x, 0);
      const y = safeNum(node.y, 0);
      const w = safeNum((node as { width?: unknown }).width, 100);
      const h = safeNum((node as { height?: unknown }).height, 100);

      const fillRaw = (node as { fill?: unknown }).fill;
      const strokeRaw = (node as { stroke?: Stroke }).stroke;
      const effectRaw = (node as { effect?: unknown }).effect;

      const fillPaints = penFillsToFigPaints(fillRaw);
      const strokePaints = strokeRaw?.fill ? penFillsToFigPaints(strokeRaw.fill) : undefined;
      const strokeWeight = (() => {
        if (!strokeRaw) return undefined;
        if (typeof strokeRaw.thickness === 'number' && Number.isFinite(strokeRaw.thickness)) {
          return strokeRaw.thickness;
        }
        if (strokeRaw.thickness && typeof strokeRaw.thickness === 'object') {
          const vals = Object.values(strokeRaw.thickness).filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
          );
          if (vals.length > 0) return Math.max(...vals);
        }
        return 1;
      })();
      const strokeAlignFig = mapStrokeAlignToFig(strokeRaw?.align);
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
        name: String(node.name ?? node.id ?? 'Layer'),
        visible: (node as { enabled?: boolean }).enabled !== false,
        opacity: clamp01(safeNum((node as { opacity?: unknown }).opacity, 1)),
        size: { x: w, y: h },
        transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y },
        ...(fillPaints ? { fillPaints } : {}),
        ...(strokePaints ? { strokePaints } : {}),
        ...(strokeWeight !== undefined ? { strokeWeight } : {}),
        ...(strokeAlignFig ? { strokeAlign: strokeAlignFig } : {}),
        ...(effects ? { effects } : {}),
        ...((node as { layoutPosition?: string }).layoutPosition === 'absolute'
          ? { stackPositioning: 'ABSOLUTE' }
          : {}),
      };

      const cornerRadius = (node as { cornerRadius?: number | number[] }).cornerRadius;
      if (typeof cornerRadius === 'number' && Number.isFinite(cornerRadius)) {
        nc.cornerRadius = cornerRadius;
      } else if (Array.isArray(cornerRadius) && typeof cornerRadius[0] === 'number' && Number.isFinite(cornerRadius[0])) {
        nc.cornerRadius = cornerRadius[0];
      }

      if (node.type === 'frame') {
        nc.clipsContent = node.clip !== false;
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        if (node.layout === 'none') {
          nc.stackMode = 'NONE';
        } else if (node.layout === 'vertical') {
          nc.stackMode = 'VERTICAL';
        } else if (node.layout === 'horizontal' || hasChildren) {
          // Pencil frames default to horizontal flex when layout is omitted
          nc.stackMode = 'HORIZONTAL';
        }
        if (typeof node.gap === 'number' && Number.isFinite(node.gap)) nc.stackSpacing = node.gap;
        if (typeof node.padding === 'number' && Number.isFinite(node.padding)) {
          nc.stackHorizontalPadding = node.padding;
          nc.stackVerticalPadding = node.padding;
          nc.stackPaddingRight = node.padding;
          nc.stackPaddingBottom = node.padding;
        } else if (Array.isArray(node.padding)) {
          const top = safeNum(node.padding[0], 0);
          const right = safeNum(node.padding[1] ?? top, 0);
          const bottom = safeNum(node.padding[2] ?? top, 0);
          const left = safeNum(node.padding[3] ?? right, 0);
          nc.stackVerticalPadding = top;
          nc.stackHorizontalPadding = left;
          nc.stackPaddingRight = right;
          nc.stackPaddingBottom = bottom;
        }
        const primary = mapPenAlignToFig(node.justifyContent);
        const counter = mapPenAlignToFig(node.alignItems);
        if (primary) nc.stackPrimaryAlignItems = primary;
        if (counter) nc.stackCounterAlignItems = counter;
      }

      if (node.type === 'text') {
        nc.textData = { characters: safeTextContent(node.content) };
        nc.fontSize = safeNum(node.fontSize, 16);
        nc.fontName = {
          family: typeof node.fontFamily === 'string' && node.fontFamily ? node.fontFamily : 'Inter',
          style: mapFontStyle(node.fontWeight),
          postscript: '',
        };
        const textAlignFig = mapTextAlignToFig(node.textAlign);
        if (textAlignFig) {
          nc.textAlignHorizontal = textAlignFig;
        }
      }

      if (node.type === 'polygon' && typeof node.polygonCount === 'number' && Number.isFinite(node.polygonCount)) {
        nc.count = Math.max(3, Math.round(node.polygonCount));
      }

      if (node.type === 'path' && typeof node.geometry === 'string' && node.geometry.trim()) {
        const blob = svgPathToVectorNetworkBlob(node.geometry, w, h);
        if (blob) {
          nc.vectorData = {
            vectorNetworkBlob: pushBlob(blob),
            normalizedSize: { x: w, y: h },
          };
        }
      }

      if (node.type === 'icon_font') {
        const family = typeof node.iconFontFamily === 'string' ? node.iconFontFamily : 'lucide';
        const iconName = typeof node.iconFontName === 'string' ? node.iconFontName : '';
        const normalizedKey = iconName.trim().toLowerCase();
        const mappedLucideName =
          MATERIAL_TO_LUCIDE[normalizedKey] ??
          (family.toLowerCase().includes('material') ? normalizedKey.replace(/_/g, '-') : iconName);
        const lucideData =
          (iconName ? lookupLucideIcon(iconName) : null) ??
          (mappedLucideName ? lookupLucideIcon(mappedLucideName) : null);
        const vecRes = lucideData ? lucideToVectorNetworkBlob(lucideData, w, h) : null;

        if (vecRes) {
          // Wrap the vector inside a transparent w x h FRAME so Auto Layout slots stay exact
          nc.type = 'FRAME';
          nc.clipsContent = false;
          nc.stackMode = 'NONE';
          delete nc.fillPaints;
          delete nc.strokePaints;
          delete nc.strokeWeight;

          const vecGuid = allocGuid();
          const vecNode: FigNodeChange = {
            guid: vecGuid,
            phase: 'CREATED',
            parentIndex: { guid, position: '00000' },
            type: 'VECTOR',
            name: `${String(node.name ?? iconName ?? 'Icon')} Vector`,
            visible: true,
            opacity: 1,
            size: { x: vecRes.width, y: vecRes.height },
            transform: {
              m00: 1,
              m01: 0,
              m02: vecRes.offsetX,
              m10: 0,
              m11: 1,
              m12: vecRes.offsetY,
            },
            vectorData: {
              vectorNetworkBlob: pushBlob(vecRes.blob),
              normalizedSize: { x: vecRes.width, y: vecRes.height },
            },
            ...(fillPaints ? { strokePaints: fillPaints } : strokePaints ? { strokePaints } : {}),
            strokeWeight: Math.max(1, Number(((2 * Math.min(w, h)) / 24).toFixed(2))),
            strokeCap: 'ROUND',
            strokeJoin: 'ROUND',
          };
          changes.push(nc);
          changes.push(vecNode);
          return;
        } else if (family.toLowerCase().includes('material')) {
          nc.type = 'TEXT';
          nc.textData = { characters: iconName };
          nc.fontSize = Math.max(12, Math.min(w, h));
          nc.fontName = { family, style: 'Regular', postscript: '' };
          nc.textAlignHorizontal = 'CENTER';
        }
      }

      changes.push(nc);

      const children = (node as { children?: PenNode[] }).children;
      if (Array.isArray(children) && children.length > 0) {
        visit(children, guid);
      }
    });
  };

  visit(doc.children, canvasGuid);
  return buildFigFile(changes, title, blobs);
}

