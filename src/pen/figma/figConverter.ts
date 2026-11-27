import type {
  Effect,
  Fill,
  PenDocument,
  PenNode,
  PenPage,
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
  commandsBlobToSvgPath,
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

interface FigImportContext {
  byId: Map<string, FigNodeChange>;
  childrenMap: Map<string, FigNodeChange[]>;
  blobs: FigBlob[];
  images: Record<string, Uint8Array>;
  imageUrlCache: Map<string, string>;
}

function hashToHex(hash: unknown): string | null {
  if (!hash) return null;
  if (hash instanceof Uint8Array) {
    return Array.from(hash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  if (typeof hash === 'object') {
    const rec = hash as Record<string, unknown>;
    const bytes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const v = rec[String(i)];
      if (typeof v !== 'number') return null;
      bytes.push(v & 0xff);
    }
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }
  return 'image/png';
}

function resolveImageUrl(paint: FigPaint, ctx?: FigImportContext): string | null {
  if (!ctx) return null;
  const p = paint as Record<string, unknown>;
  const imgObj = p.image as { hash?: unknown } | undefined;
  const thumbObj = p.imageThumbnail as { hash?: unknown } | undefined;
  const hex = hashToHex(imgObj?.hash) ?? hashToHex(thumbObj?.hash);
  if (!hex) return null;

  const cached = ctx.imageUrlCache.get(hex);
  if (cached) return cached;

  const bytes = ctx.images[hex];
  if (!bytes || bytes.byteLength === 0) return null;

  const mime = detectImageMime(bytes);
  let url: string;
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    url = URL.createObjectURL(new Blob([copy], { type: mime }));
  } else {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    url = `data:${mime};base64,${btoa(binary)}`;
  }
  ctx.imageUrlCache.set(hex, url);
  return url;
}

function figPaintsToPenFills(paints?: FigPaint[], ctx?: FigImportContext): Fill[] | undefined {
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
    } else if (p.type === 'IMAGE') {
      const url = resolveImageUrl(p, ctx);
      if (url) {
        const scaleMode = String((p as Record<string, unknown>).imageScaleMode ?? 'FILL').toUpperCase();
        const mode: 'fill' | 'fit' | 'stretch' =
          scaleMode === 'FIT' ? 'fit' : scaleMode === 'STRETCH' ? 'stretch' : 'fill';
        out.push({
          type: 'image',
          url,
          mode,
          ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
        });
      }
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

function extractCornerRadius(nc: FigNodeChange): number | [number, number, number, number] | undefined {
  const r = nc as unknown as Record<string, unknown>;
  const tl = typeof r.rectangleTopLeftCornerRadius === 'number' ? r.rectangleTopLeftCornerRadius : undefined;
  const tr = typeof r.rectangleTopRightCornerRadius === 'number' ? r.rectangleTopRightCornerRadius : undefined;
  const br = typeof r.rectangleBottomRightCornerRadius === 'number' ? r.rectangleBottomRightCornerRadius : undefined;
  const bl = typeof r.rectangleBottomLeftCornerRadius === 'number' ? r.rectangleBottomLeftCornerRadius : undefined;
  if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
    const a = tl ?? nc.cornerRadius ?? 0;
    const b = tr ?? nc.cornerRadius ?? 0;
    const c = br ?? nc.cornerRadius ?? 0;
    const d = bl ?? nc.cornerRadius ?? 0;
    if (a === b && b === c && c === d) return a > 0 ? a : undefined;
    return [a, b, c, d];
  }
  return nc.cornerRadius ? nc.cornerRadius : undefined;
}

function extractFillGeometryPath(nc: FigNodeChange, blobs: FigBlob[]): string {
  const r = nc as unknown as Record<string, unknown>;
  const fillGeom = r.fillGeometry as Array<{ commandsBlob?: number }> | undefined;
  if (Array.isArray(fillGeom) && fillGeom.length > 0) {
    const parts: string[] = [];
    for (const fg of fillGeom) {
      if (typeof fg?.commandsBlob === 'number') {
        const blob = blobs[fg.commandsBlob];
        if (blob?.bytes) {
          const d = commandsBlobToSvgPath(blob.bytes);
          if (d) parts.push(d);
        }
      }
    }
    if (parts.length > 0) return parts.join(' ');
  }
  const blobIdx = nc.vectorData?.vectorNetworkBlob;
  const blob = typeof blobIdx === 'number' ? blobs[blobIdx] : undefined;
  return blob?.bytes ? vectorNetworkBlobToSvgPath(blob.bytes) : '';
}

function scaleSvgPath(d: string, sx: number, sy: number): string {
  const f = (n: number) => Number(n.toFixed(2));
  const tokens = d.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return d;
  const out: string[] = [];
  let cmd = '';
  let argIdx = 0;
  for (const tok of tokens) {
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok;
      argIdx = 0;
      out.push(tok);
      continue;
    }
    const num = Number(tok);
    if (!Number.isFinite(num)) {
      out.push(tok);
      continue;
    }
    const upper = cmd.toUpperCase();
    if (upper === 'H') {
      out.push(String(f(num * sx)));
    } else if (upper === 'V') {
      out.push(String(f(num * sy)));
    } else {
      out.push(String(f(num * (argIdx % 2 === 0 ? sx : sy))));
    }
    argIdx++;
  }
  return out.join(' ');
}

function scalePenNodes(nodes: PenNode[], sx: number, sy: number): PenNode[] {
  return nodes.map((n) => {
    const rec = { ...(n as unknown as Record<string, unknown>) };
    if (typeof rec.x === 'number') rec.x = rec.x * sx;
    if (typeof rec.y === 'number') rec.y = rec.y * sy;
    if (typeof rec.width === 'number') rec.width = rec.width * sx;
    if (typeof rec.height === 'number') rec.height = rec.height * sy;
    if (rec.type === 'path' && typeof rec.geometry === 'string') {
      rec.geometry = scaleSvgPath(rec.geometry, sx, sy);
    }
    if (Array.isArray(rec.children)) {
      rec.children = scalePenNodes(rec.children as PenNode[], sx, sy);
    }
    return rec as unknown as PenNode;
  });
}

function collectInstanceOverrides(nc: FigNodeChange): Map<string, Partial<FigNodeChange>> {
  const map = new Map<string, Partial<FigNodeChange>>();
  const r = nc as unknown as Record<string, unknown>;
  const symData = r.symbolData as { symbolOverrides?: Array<Record<string, unknown>> } | undefined;
  const derived = r.derivedSymbolData as Array<Record<string, unknown>> | undefined;

  const mergeList = (list?: Array<Record<string, unknown>>) => {
    if (!Array.isArray(list)) return;
    for (const ov of list) {
      const gp = ov.guidPath as { guids?: FigGuid[] } | undefined;
      const guids = gp?.guids;
      if (!Array.isArray(guids) || guids.length === 0) continue;
      const targetKey = guidKey(guids[guids.length - 1]);
      const prev = map.get(targetKey) ?? {};
      map.set(targetKey, { ...prev, ...(ov as Partial<FigNodeChange>) });
    }
  };
  mergeList(derived);
  mergeList(symData?.symbolOverrides);
  return map;
}

function convertFigNodeToPen(
  rawNc: FigNodeChange,
  ctx: FigImportContext,
  idPrefix = '',
  overrides?: Map<string, Partial<FigNodeChange>>,
  visitedSymbols: Set<string> = new Set(),
  depth = 0,
): PenNode | null {
  if (depth > 28) return null;
  if (rawNc.phase === 'REMOVED') return null;

  const origId = guidKey(rawNc.guid);
  const ov = overrides?.get(origId);
  const nc: FigNodeChange = ov
    ? {
        ...rawNc,
        ...ov,
        guid: rawNc.guid,
        type: rawNc.type,
        size: ov.size ?? rawNc.size,
        transform: ov.transform ?? rawNc.transform,
      }
    : rawNc;

  const id = idPrefix ? `${idPrefix}__${origId}` : origId;
  const width = nc.size?.x ?? 0;
  const height = nc.size?.y ?? 0;

  // Extract position and rotation from Figma's 2x3 affine transform matrix
  const m00 = nc.transform?.m00 ?? 1;
  const m01 = nc.transform?.m01 ?? 0;
  const m02 = nc.transform?.m02 ?? 0;
  const m10 = nc.transform?.m10 ?? 0;
  const m11 = nc.transform?.m11 ?? 1;
  const m12 = nc.transform?.m12 ?? 0;
  const det = m00 * m11 - m01 * m10;
  const isFlipped = det < 0;
  // For reflections (det < 0, e.g. horizontal flip m00=-1, m11=1), negate the X basis vector
  // so a horizontal flip is not misinterpreted as a 180° rotation.
  const rad = isFlipped ? Math.atan2(-m10, -m00) : Math.atan2(m10, m00);
  const hasRotation = Math.abs(rad) > 1e-3 && width > 0 && height > 0;
  let x = m02;
  let y = m12;
  let rotation: number | undefined;
  if ((hasRotation || isFlipped) && width > 0 && height > 0) {
    // Figma transforms around top-left (m02, m12); OpenPenViewer rotates around center (x + w/2, y + h/2)
    const cx = m00 * (width / 2) + m01 * (height / 2) + m02;
    const cy = m10 * (width / 2) + m11 * (height / 2) + m12;
    x = cx - width / 2;
    y = cy - height / 2;
    if (hasRotation) {
      rotation = Number(((-rad * 180) / Math.PI).toFixed(2));
    }
  }

  const fills = figPaintsToPenFills(nc.fillPaints, ctx);
  const strokeFills = figPaintsToPenFills(nc.strokePaints, ctx);
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
  const cornerRadius = extractCornerRadius(nc);

  const base = {
    id,
    name: nc.name,
    x,
    y,
    ...(rotation !== undefined ? { rotation } : {}),
    ...(nc.visible === false ? { enabled: false } : {}),
    ...(nc.opacity !== undefined && nc.opacity < 1 ? { opacity: nc.opacity } : {}),
    ...(nc.stackPositioning === 'ABSOLUTE' ? { layoutPosition: 'absolute' as const } : {}),
  };

  let rawChildren = ctx.childrenMap.get(origId) ?? [];
  let nextOverrides = overrides;
  let nextVisited = visitedSymbols;
  let nextPrefix = idPrefix;

  // Expand Figma INSTANCE from its master SYMBOL when instance has no direct children
  let instanceScaleX = 1;
  let instanceScaleY = 1;
  if (nc.type === 'INSTANCE' && rawChildren.length === 0) {
    const symData = (nc as unknown as Record<string, unknown>).symbolData as
      | { symbolID?: FigGuid }
      | undefined;
    const symKey = symData?.symbolID ? guidKey(symData.symbolID) : '';
    if (symKey && !visitedSymbols.has(symKey)) {
      const masterNode = ctx.byId.get(symKey);
      const masterKids = ctx.childrenMap.get(symKey) ?? [];
      if (masterKids.length > 0) {
        rawChildren = masterKids;
        nextVisited = new Set(visitedSymbols);
        nextVisited.add(symKey);
        nextPrefix = id;
        const instOverrides = collectInstanceOverrides(nc);
        if (instOverrides.size > 0) {
          nextOverrides = overrides
            ? new Map([...overrides, ...instOverrides])
            : instOverrides;
        }
        const mw = masterNode?.size?.x ?? 0;
        const mh = masterNode?.size?.y ?? 0;
        if (mw > 0 && mh > 0 && width > 0 && height > 0) {
          instanceScaleX = width / mw;
          instanceScaleY = height / mh;
        }
      }
    }
  }

  const rawChildNodes = rawChildren
    .map((child) =>
      convertFigNodeToPen(child, ctx, nextPrefix, nextOverrides, nextVisited, depth + 1),
    )
    .filter((n): n is PenNode => n !== null);

  // If INSTANCE size differs from master SYMBOL size, scale child coordinates & dimensions proportionally
  const childNodes =
    Math.abs(instanceScaleX - 1) > 0.01 || Math.abs(instanceScaleY - 1) > 0.01
      ? scalePenNodes(rawChildNodes, instanceScaleX, instanceScaleY)
      : rawChildNodes;

  switch (nc.type) {
    case 'FRAME':
    case 'COMPONENT':
    case 'SYMBOL':
    case 'INSTANCE':
    case 'SECTION': {
      const rawFrame = nc as unknown as Record<string, unknown>;
      const isWrapped = rawFrame.stackWrap === 'WRAP';
      const hasComplexFlexChild = rawChildren.some((c) => {
        const cr = c as unknown as Record<string, unknown>;
        return (
          (typeof cr.stackChildPrimaryGrow === 'number' && cr.stackChildPrimaryGrow > 0) ||
          cr.stackChildAlignSelf === 'STRETCH'
        );
      });
      // Preserve Figma's exact pre-computed child coordinates for wrapped or stretch-flex containers
      const layout =
        nc.type === 'SECTION' || isWrapped || hasComplexFlexChild
          ? 'none'
          : nc.stackMode === 'HORIZONTAL'
            ? 'horizontal'
            : nc.stackMode === 'VERTICAL'
              ? 'vertical'
              : 'none';
      const clip =
        typeof rawFrame.frameMaskDisabled === 'boolean'
          ? !rawFrame.frameMaskDisabled
          : nc.clipsContent;
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
        ...(cornerRadius !== undefined
          ? { cornerRadius }
          : nc.type === 'SECTION'
            ? { cornerRadius: 8 }
            : {}),
        ...(clip !== undefined ? { clip } : {}),
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
      return {
        ...base,
        type: 'group',
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        children: childNodes,
      } as PenNode;

    case 'BOOLEAN_OPERATION': {
      const geometry = extractFillGeometryPath(nc, ctx.blobs);
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
        type: 'group',
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        children: childNodes,
      } as PenNode;
    }

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
      const rawText = nc as unknown as Record<string, unknown>;
      const autoResize = rawText.textAutoResize as string | undefined;
      const textGrowth =
        autoResize === 'WIDTH_AND_HEIGHT'
          ? 'auto'
          : autoResize === 'HEIGHT'
            ? 'fixed-width'
            : autoResize === 'NONE'
              ? 'fixed-width-height'
              : undefined;
      const fontSize = nc.fontSize ?? 16;
      const lhObj = rawText.lineHeight as { value?: number; units?: string } | undefined;
      let lineHeight: number | undefined;
      if (lhObj && typeof lhObj.value === 'number' && Number.isFinite(lhObj.value) && lhObj.value > 0) {
        if (lhObj.units === 'PIXELS') lineHeight = Number((lhObj.value / fontSize).toFixed(3));
        else if (lhObj.units === 'PERCENT') lineHeight = Number((lhObj.value / 100).toFixed(3));
        else if (lhObj.units === 'RAW') lineHeight = lhObj.value;
      }
      const lsObj = rawText.letterSpacing as { value?: number; units?: string } | undefined;
      let letterSpacing: number | undefined;
      if (lsObj && typeof lsObj.value === 'number' && Number.isFinite(lsObj.value) && lsObj.value !== 0) {
        letterSpacing =
          lsObj.units === 'PERCENT'
            ? Number(((lsObj.value / 100) * fontSize).toFixed(2))
            : lsObj.value;
      }
      const rawCase = rawText.textCase as string | undefined;
      const textCase =
        rawCase === 'UPPER'
          ? 'upper'
          : rawCase === 'LOWER'
            ? 'lower'
            : rawCase === 'TITLE'
              ? 'title'
              : undefined;
      const rawVAlign = rawText.textAlignVertical as string | undefined;
      const textAlignVertical =
        rawVAlign === 'CENTER'
          ? 'middle'
          : rawVAlign === 'BOTTOM'
            ? 'bottom'
            : rawVAlign === 'TOP'
              ? 'top'
              : undefined;
      return {
        ...base,
        type: 'text',
        width,
        height,
        content: nc.textData?.characters ?? nc.name ?? '',
        fontSize,
        ...(nc.fontName?.family ? { fontFamily: nc.fontName.family } : {}),
        ...(weight ? { fontWeight: weight } : {}),
        ...(lineHeight !== undefined ? { lineHeight } : {}),
        ...(letterSpacing !== undefined ? { letterSpacing } : {}),
        ...(textGrowth ? { textGrowth } : {}),
        ...(textCase ? { textCase } : {}),
        ...(nc.textAlignHorizontal
          ? { textAlign: nc.textAlignHorizontal.toLowerCase() }
          : {}),
        ...(textAlignVertical ? { textAlignVertical } : {}),
        ...(textFill ? { fill: textFill } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
    }

    case 'VECTOR': {
      const geometry = extractFillGeometryPath(nc, ctx.blobs);
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
        ...(cornerRadius !== undefined ? { cornerRadius } : {}),
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
        ...(cornerRadius !== undefined ? { cornerRadius } : {}),
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

  const ctx: FigImportContext = {
    byId,
    childrenMap,
    blobs,
    images: parsed.images ?? {},
    imageUrlCache: new Map(),
  };

  const allCanvases = nodeChanges.filter((nc) => nc.type === 'CANVAS');
  const visibleCanvases = allCanvases.filter((c) => {
    const rec = c as unknown as Record<string, unknown>;
    if (rec.internalOnly === true) return false;
    const kids = childrenMap.get(guidKey(c.guid)) ?? [];
    const name = (c.name ?? '').trim();
    if (!name && kids.length === 0) return false;
    return true;
  });

  if (visibleCanvases.length > 0) {
    const pages: PenPage[] = visibleCanvases.map((canvas, idx) => {
      const cid = guidKey(canvas.guid);
      const topNodes = childrenMap.get(cid) ?? [];
      const children = topNodes
        .map((nc) => convertFigNodeToPen(nc, ctx))
        .filter((n): n is PenNode => n !== null);
      return {
        id: cid,
        name: (canvas.name ?? '').trim() || `Page ${idx + 1}`,
        children,
      };
    });

    const activePage = pages.find((p) => p.children.length > 0) ?? pages[0];
    if (pages.length > 1) {
      return {
        version: '1.0',
        children: activePage.children,
        pages,
        activePageId: activePage.id,
      };
    }
    return {
      version: '1.0',
      children: activePage.children,
    };
  }

  const rootNodes: PenNode[] = [];
  for (const nc of nodeChanges) {
    if (nc.type === 'DOCUMENT') continue;
    const pKey = nc.parentIndex?.guid ? guidKey(nc.parentIndex.guid) : '';
    if (!pKey || !byId.has(pKey)) {
      const converted = convertFigNodeToPen(nc, ctx);
      if (converted) rootNodes.push(converted);
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

