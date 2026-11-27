import type {
  BlendMode,
  Effect,
  Fill,
  LayoutGrid,
  PenDocument,
  PenNode,
  PenPage,
  Stroke,
  StrokeThickness,
  TextGlyphRun,
  TextSpan,
} from '../types';
import {
  buildFigFile,
  parseFigFile,
  type FigBlob,
  type FigColor,
  type FigDerivedGlyph,
  type FigDerivedTextData,
  type FigEffect,
  type FigGeometryItem,
  type FigGuid,
  type FigMatrix,
  type FigNodeChange,
  type FigPaint,
  type FigStyleOverride,
} from './figKiwi';
import { lookupLucideIcon } from '../renderer/lucideIcons';
import { booleanOperation, type BoolOp } from '../renderer/booleanOps';
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

interface ScopedOverrideEntry {
  guids: string[];
  patch: Partial<FigNodeChange>;
}

interface FigImportContext {
  byId: Map<string, FigNodeChange>;
  childrenMap: Map<string, FigNodeChange[]>;
  blobs: FigBlob[];
  blobPathCache: Map<number, string>;
  images: Record<string, Uint8Array>;
  imageUrlCache: Map<string, { url: string; width?: number; height?: number }>;
  preserveLayoutPositions: boolean;
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

function parseImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG
  if (bytes.byteLength >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.byteLength) {
      if (bytes[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = bytes[off + 1];
      if (marker === 0xff) {
        off++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        off += 2;
        continue;
      }
      if (off + 4 > bytes.byteLength) break;
      const segLen = view.getUint16(off + 2, false);
      if (segLen < 2) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (off + 9 <= bytes.byteLength) {
          const height = view.getUint16(off + 5, false);
          const width = view.getUint16(off + 7, false);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        break;
      }
      off += 2 + segLen;
    }
  }
  // WebP
  if (bytes.byteLength >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8 ' && bytes.byteLength >= 30) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8L' && bytes.byteLength >= 25) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8X' && bytes.byteLength >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

function resolveImageAsset(
  paint: FigPaint,
  ctx?: FigImportContext,
): { url: string; width?: number; height?: number } | null {
  if (!ctx) return null;
  const hex = hashToHex(paint.image?.hash) ?? hashToHex(paint.imageThumbnail?.hash);
  if (!hex) return null;

  const cached = ctx.imageUrlCache.get(hex);
  if (cached) return cached;

  const bytes = ctx.images[hex];
  if (!bytes || bytes.byteLength === 0) return null;

  const mime = detectImageMime(bytes);
  const dims = parseImageDimensions(bytes);
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
  const asset = {
    url,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
  };
  ctx.imageUrlCache.set(hex, asset);
  return asset;
}

function invertAffine2x3(m?: FigMatrix): FigMatrix | null {
  if (!m) return null;
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return null;
  const invDet = 1 / det;
  const m00 = m.m11 * invDet;
  const m01 = -m.m01 * invDet;
  const m10 = -m.m10 * invDet;
  const m11 = m.m00 * invDet;
  const m02 = -(m00 * m.m02 + m01 * m.m12);
  const m12 = -(m10 * m.m02 + m11 * m.m12);
  return { m00, m01, m02, m10, m11, m12 };
}

function isIdentityMatrix(m?: FigMatrix): boolean {
  if (!m) return true;
  return (
    Math.abs((m.m00 ?? 1) - 1) < 1e-3 &&
    Math.abs(m.m01 ?? 0) < 1e-3 &&
    Math.abs(m.m02 ?? 0) < 1e-3 &&
    Math.abs(m.m10 ?? 0) < 1e-3 &&
    Math.abs((m.m11 ?? 1) - 1) < 1e-3 &&
    Math.abs(m.m12 ?? 0) < 1e-3
  );
}

function mapFigBlendMode(mode?: string): BlendMode | undefined {
  if (!mode || mode === 'NORMAL' || mode === 'PASS_THROUGH') return undefined;
  const map: Record<string, BlendMode> = {
    DARKEN: 'Darken',
    MULTIPLY: 'Multiply',
    LINEAR_BURN: 'LinearBurn',
    COLOR_BURN: 'ColorBurn',
    LIGHTEN: 'Light',
    SCREEN: 'Screen',
    LINEAR_DODGE: 'LinearDodge',
    COLOR_DODGE: 'ColorDodge',
    OVERLAY: 'Overlay',
    SOFT_LIGHT: 'SoftLight',
    HARD_LIGHT: 'HardLight',
    DIFFERENCE: 'Difference',
    EXCLUSION: 'Exclusion',
    HUE: 'Hue',
    SATURATION: 'Saturation',
    COLOR: 'Color',
    LUMINOSITY: 'Luminosity',
  };
  return map[mode];
}

function figPaintsToPenFills(paints?: FigPaint[], ctx?: FigImportContext): Fill[] | undefined {
  if (!paints || paints.length === 0) return undefined;
  const out: Fill[] = [];
  const r4 = (n: number) => Number(n.toFixed(4));

  for (const p of paints) {
    if (p.visible === false) continue;
    const blendMode = mapFigBlendMode(p.blendMode);

    if (p.type === 'SOLID' || !p.type) {
      out.push({
        type: 'color',
        color: figColorToHex(p.color),
        ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
        ...(blendMode ? { blendMode } : {}),
      });
    } else if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_ANGULAR') {
      const gradientType =
        p.type === 'GRADIENT_RADIAL'
          ? 'radial'
          : p.type === 'GRADIENT_ANGULAR'
            ? 'angular'
            : 'linear';
      const inv = invertAffine2x3(p.transform);
      let start: { x: number; y: number } | undefined;
      let end: { x: number; y: number } | undefined;
      let transform: [number, number, number, number, number, number] | undefined;

      if (inv) {
        if (gradientType === 'linear') {
          start = {
            x: r4(inv.m00 * 0 + inv.m01 * 0.5 + inv.m02),
            y: r4(inv.m10 * 0 + inv.m11 * 0.5 + inv.m12),
          };
          end = {
            x: r4(inv.m00 * 1 + inv.m01 * 0.5 + inv.m02),
            y: r4(inv.m10 * 1 + inv.m11 * 0.5 + inv.m12),
          };
        } else if (gradientType === 'radial') {
          transform = [
            r4(inv.m00),
            r4(inv.m10),
            r4(inv.m01),
            r4(inv.m11),
            r4(inv.m02),
            r4(inv.m12),
          ];
        }
      }

      out.push({
        type: 'gradient',
        gradientType,
        colors: (p.stops ?? []).map((st) => ({
          color: figColorToHex(st.color),
          position: st.position,
        })),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(transform ? { transform } : {}),
        ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
        ...(blendMode ? { blendMode } : {}),
      });
    } else if (p.type === 'IMAGE') {
      const asset = resolveImageAsset(p, ctx);
      if (asset) {
        const scaleMode = String(p.imageScaleMode ?? 'FILL').toUpperCase();
        const origW = (p.originalImageWidth && p.originalImageWidth > 0 ? p.originalImageWidth : asset.width);
        const origH = (p.originalImageHeight && p.originalImageHeight > 0 ? p.originalImageHeight : asset.height);

        if (scaleMode === 'TILE') {
          out.push({
            type: 'image',
            url: asset.url,
            mode: 'tile',
            ...(typeof p.scalingFactor === 'number' && p.scalingFactor > 0 ? { tileScale: p.scalingFactor } : {}),
            ...(origW ? { originalWidth: origW } : {}),
            ...(origH ? { originalHeight: origH } : {}),
            ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
            ...(blendMode ? { blendMode } : {}),
          });
        } else if ((scaleMode === 'STRETCH' || scaleMode === 'CROP') && !isIdentityMatrix(p.transform)) {
          const inv = invertAffine2x3(p.transform);
          if (inv) {
            out.push({
              type: 'image',
              url: asset.url,
              mode: 'crop',
              imageTransform: [
                r4(inv.m00),
                r4(inv.m10),
                r4(inv.m01),
                r4(inv.m11),
                r4(inv.m02),
                r4(inv.m12),
              ],
              ...(origW ? { originalWidth: origW } : {}),
              ...(origH ? { originalHeight: origH } : {}),
              ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
              ...(blendMode ? { blendMode } : {}),
            });
          } else {
            out.push({
              type: 'image',
              url: asset.url,
              mode: 'stretch',
              ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
              ...(blendMode ? { blendMode } : {}),
            });
          }
        } else {
          const mode: 'fill' | 'fit' | 'stretch' =
            scaleMode === 'FIT' ? 'fit' : scaleMode === 'STRETCH' ? 'stretch' : 'fill';
          out.push({
            type: 'image',
            url: asset.url,
            mode,
            ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
            ...(blendMode ? { blendMode } : {}),
          });
        }
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
      const f = item as Partial<Fill> & {
        type?: string;
        color?: string;
        colors?: Array<{ color: string; position: number }>;
        gradientType?: string;
        opacity?: number;
        enabled?: boolean;
      };
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
  if (s.includes('black') || s.includes('heavy')) return '900';
  if ((s.includes('extra') || s.includes('ultra')) && s.includes('bold')) return '800';
  if ((s.includes('semi') || s.includes('demi')) && s.includes('bold')) return '600';
  if (s.includes('bold')) return '700';
  if (s.includes('medium')) return '500';
  if ((s.includes('extra') || s.includes('ultra')) && s.includes('light')) return '200';
  if (s.includes('light')) return '300';
  if (s.includes('thin') || s.includes('hairline')) return '100';
  return undefined;
}

function mapFigFontStyleToItalic(style?: string): 'italic' | undefined {
  if (!style) return undefined;
  const s = style.trim().toLowerCase();
  return s.includes('italic') || s.includes('oblique') ? 'italic' : undefined;
}

function mapFontStyle(weight: unknown): string {
  if (typeof weight === 'number') {
    if (weight >= 900) return 'Black';
    if (weight >= 800) return 'Extra Bold';
    if (weight >= 700) return 'Bold';
    if (weight >= 600) return 'Semi Bold';
    if (weight >= 500) return 'Medium';
    if (weight <= 200) return 'Extra Light';
    if (weight <= 300) return 'Light';
    return 'Regular';
  }
  if (typeof weight === 'string') {
    const w = weight.trim().toLowerCase();
    if (w === '900' || w === 'black' || w === 'heavy') return 'Black';
    if (w === '800' || w === 'extrabold' || w === 'extra-bold') return 'Extra Bold';
    if (w === 'bold' || w === '700') return 'Bold';
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
  const tl = typeof nc.rectangleTopLeftCornerRadius === 'number' ? nc.rectangleTopLeftCornerRadius : undefined;
  const tr = typeof nc.rectangleTopRightCornerRadius === 'number' ? nc.rectangleTopRightCornerRadius : undefined;
  const br = typeof nc.rectangleBottomRightCornerRadius === 'number' ? nc.rectangleBottomRightCornerRadius : undefined;
  const bl = typeof nc.rectangleBottomLeftCornerRadius === 'number' ? nc.rectangleBottomLeftCornerRadius : undefined;

  if (nc.rectangleCornerRadiiIndependent === true) {
    // In Figma Kiwi binary, 0 is omitted (undefined) when independent corners are enabled;
    // nc.cornerRadius still holds the stale uniform radius and MUST NOT be used as fallback.
    const a = tl ?? 0;
    const b = tr ?? 0;
    const c = br ?? 0;
    const d = bl ?? 0;
    if (a === 0 && b === 0 && c === 0 && d === 0) return undefined;
    if (a === b && b === c && c === d) return a;
    return [a, b, c, d];
  }

  if (nc.rectangleCornerRadiiIndependent === false) {
    return nc.cornerRadius && nc.cornerRadius > 0 ? nc.cornerRadius : undefined;
  }

  if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
    const a = tl ?? 0;
    const b = tr ?? 0;
    const c = br ?? 0;
    const d = bl ?? 0;
    if (a === 0 && b === 0 && c === 0 && d === 0) return undefined;
    if (a === b && b === c && c === d) return a;
    return [a, b, c, d];
  }
  return nc.cornerRadius && nc.cornerRadius > 0 ? nc.cornerRadius : undefined;
}

function getCachedBlobSvgPath(blobIdx: number, ctx: FigImportContext): string {
  const cached = ctx.blobPathCache.get(blobIdx);
  if (cached !== undefined) return cached;
  const blob = ctx.blobs[blobIdx];
  const d = blob?.bytes ? commandsBlobToSvgPath(blob.bytes) : '';
  ctx.blobPathCache.set(blobIdx, d);
  return d;
}

function extractGeometryItemsPath(
  items: FigGeometryItem[] | undefined,
  ctx: FigImportContext,
): { path: string; fillRule?: 'evenodd' | 'nonzero' } | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts: string[] = [];
  let hasEvenOdd = false;
  for (const item of items) {
    if (item?.windingRule === 'EVENODD' || item?.windingRule === 'ODD') {
      hasEvenOdd = true;
    }
    if (typeof item?.commandsBlob === 'number') {
      const d = getCachedBlobSvgPath(item.commandsBlob, ctx);
      if (d) parts.push(d);
    }
  }
  if (parts.length === 0) return null;
  return {
    path: parts.join(' '),
    ...(hasEvenOdd ? { fillRule: 'evenodd' } : {}),
  };
}

function scaleSvgPath(d: string, sx: number, sy: number): string {
  const f = (n: number) => Math.round(n * 100) / 100;
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

function extractVectorNetworkPath(
  nc: FigNodeChange,
  blobs: FigBlob[],
  width: number,
  height: number,
): string {
  const blobIdx = nc.vectorData?.vectorNetworkBlob;
  const blob = typeof blobIdx === 'number' ? blobs[blobIdx] : undefined;
  if (!blob?.bytes) return '';
  const rawPath = vectorNetworkBlobToSvgPath(blob.bytes);
  if (!rawPath) return '';
  const norm = nc.vectorData?.normalizedSize;
  if (
    norm &&
    norm.x > 0 &&
    norm.y > 0 &&
    width > 0 &&
    height > 0 &&
    (Math.abs(norm.x - width) > 0.05 || Math.abs(norm.y - height) > 0.05)
  ) {
    return scaleSvgPath(rawPath, width / norm.x, height / norm.y);
  }
  return rawPath;
}

function scalePenNodes(nodes: PenNode[], sx: number, sy: number): PenNode[] {
  const strokeScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  return nodes.map((n) => {
    const rec = { ...(n as unknown as Record<string, unknown>) };
    if (typeof rec.x === 'number') rec.x = rec.x * sx;
    if (typeof rec.y === 'number') rec.y = rec.y * sy;
    if (typeof rec.width === 'number') rec.width = rec.width * sx;
    if (typeof rec.height === 'number') rec.height = rec.height * sy;
    if (rec.type === 'path' && typeof rec.geometry === 'string') {
      rec.geometry = scaleSvgPath(rec.geometry, sx, sy);
    }
    if (rec.stroke && typeof rec.stroke === 'object') {
      const st = { ...(rec.stroke as Stroke) };
      if (typeof st.thickness === 'number') {
        st.thickness = Number((st.thickness * strokeScale).toFixed(2));
      }
      rec.stroke = st;
    }
    if (Array.isArray(rec.children)) {
      rec.children = scalePenNodes(rec.children as PenNode[], sx, sy);
    }
    return rec as unknown as PenNode;
  });
}

function buildScopedEntriesFromInstance(nc: FigNodeChange): ScopedOverrideEntry[] {
  const out: ScopedOverrideEntry[] = [];
  if (Array.isArray(nc.derivedSymbolData)) {
    for (const d of nc.derivedSymbolData) {
      const guids = d.guidPath?.guids?.map(guidKey).filter(Boolean) ?? [];
      if (guids.length === 0) continue;
      const patch: Partial<FigNodeChange> = {};
      if (d.size) patch.size = d.size;
      if (d.transform) patch.transform = d.transform;
      if (d.derivedTextData) patch.derivedTextData = d.derivedTextData;
      if (d.fillGeometry) patch.fillGeometry = d.fillGeometry;
      if (d.strokeGeometry) patch.strokeGeometry = d.strokeGeometry;
      out.push({ guids, patch });
    }
  }
  if (Array.isArray(nc.symbolData?.symbolOverrides)) {
    for (const ov of nc.symbolData.symbolOverrides) {
      const guids = ov.guidPath?.guids?.map(guidKey).filter(Boolean) ?? [];
      if (guids.length === 0) continue;
      out.push({ guids, patch: ov });
    }
  }
  return out;
}

function getNodeMatchKeys(nc: FigNodeChange): Set<string> {
  const s = new Set<string>();
  s.add(guidKey(nc.guid));
  if (nc.overrideKey) s.add(guidKey(nc.overrideKey));
  return s;
}

function mergeNodeWithPatch(base: FigNodeChange, patch: Partial<FigNodeChange>): FigNodeChange {
  const indepCornersReplaced = patch.rectangleCornerRadiiIndependent === true;
  const indepBordersReplaced = patch.borderStrokeWeightsIndependent === true;
  return {
    ...base,
    ...patch,
    ...(indepCornersReplaced
      ? {
          rectangleTopLeftCornerRadius: patch.rectangleTopLeftCornerRadius,
          rectangleTopRightCornerRadius: patch.rectangleTopRightCornerRadius,
          rectangleBottomRightCornerRadius: patch.rectangleBottomRightCornerRadius,
          rectangleBottomLeftCornerRadius: patch.rectangleBottomLeftCornerRadius,
        }
      : {}),
    ...(indepBordersReplaced
      ? {
          borderTopWeight: patch.borderTopWeight,
          borderRightWeight: patch.borderRightWeight,
          borderBottomWeight: patch.borderBottomWeight,
          borderLeftWeight: patch.borderLeftWeight,
        }
      : {}),
    guid: base.guid,
    overrideKey: base.overrideKey,
    type: base.type,
    size: patch.size ?? base.size,
    transform: patch.transform ?? base.transform,
  };
}

function mapFigLayoutGrids(rawGrids: unknown): LayoutGrid[] | undefined {
  if (!Array.isArray(rawGrids) || rawGrids.length === 0) return undefined;
  const out: LayoutGrid[] = [];
  for (const item of rawGrids) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const rawPattern = String(g.pattern ?? '').toUpperCase();
    const rawAxis = String(g.axis ?? '').toUpperCase();
    const pattern: 'columns' | 'rows' | 'grid' =
      rawPattern === 'COLUMNS' ||
      rawPattern === 'STRIPES_VERTICAL' ||
      (rawPattern === 'STRIPES' && rawAxis !== 'Y')
        ? 'columns'
        : rawPattern === 'ROWS' ||
            rawPattern === 'STRIPES_HORIZONTAL' ||
            (rawPattern === 'STRIPES' && rawAxis === 'Y')
          ? 'rows'
          : 'grid';
    const rawAlign = String(g.type ?? g.alignment ?? g.axisAlignment ?? 'STRETCH').toUpperCase();
    const alignment: 'min' | 'max' | 'center' | 'stretch' =
      rawAlign === 'MIN'
        ? 'min'
        : rawAlign === 'MAX'
          ? 'max'
          : rawAlign === 'CENTER'
            ? 'center'
            : 'stretch';
    const figColor = g.color as FigColor | undefined;
    const opacity = typeof figColor?.a === 'number' ? clamp01(figColor.a) : 0.1;
    const color = figColor ? figColorToHex({ ...figColor, a: 1 }) : undefined;
    out.push({
      pattern,
      ...(typeof g.numSections === 'number' && g.numSections < 10000 ? { count: g.numSections } : {}),
      ...(typeof g.sectionSize === 'number' ? { size: g.sectionSize, sectionSize: g.sectionSize } : {}),
      ...(typeof g.gutterSize === 'number' ? { gutter: g.gutterSize } : {}),
      ...(typeof g.offset === 'number' ? { offset: g.offset } : {}),
      alignment,
      ...(color ? { color } : {}),
      opacity,
      visible: g.visible === true,
    });
  }
  return out.length > 0 ? out : undefined;
}

function decodeGlyphCommandsToSvgPath(
  bytes: Uint8Array,
  posX: number,
  posY: number,
  fontSize: number,
): string {
  if (!bytes || bytes.byteLength === 0) return '';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const parts: string[] = [];
  const tx = (gx: number) => Math.round((posX + gx * fontSize) * 100) / 100;
  const ty = (gy: number) => Math.round((posY - gy * fontSize) * 100) / 100;

  while (off < bytes.byteLength) {
    const cmd = view.getUint8(off++);
    switch (cmd) {
      case 0:
        if (parts.length > 0 && parts[parts.length - 1] !== 'Z') {
          parts.push('Z');
        }
        break;
      case 1:
        if (off + 8 > bytes.byteLength) return parts.join(' ');
        parts.push(`M ${tx(view.getFloat32(off, true))} ${ty(view.getFloat32(off + 4, true))}`);
        off += 8;
        break;
      case 2:
        if (off + 8 > bytes.byteLength) return parts.join(' ');
        parts.push(`L ${tx(view.getFloat32(off, true))} ${ty(view.getFloat32(off + 4, true))}`);
        off += 8;
        break;
      case 3:
        if (off + 16 > bytes.byteLength) return parts.join(' ');
        parts.push(
          `Q ${tx(view.getFloat32(off, true))} ${ty(view.getFloat32(off + 4, true))} ${tx(view.getFloat32(off + 8, true))} ${ty(view.getFloat32(off + 12, true))}`,
        );
        off += 16;
        break;
      case 4:
        if (off + 24 > bytes.byteLength) return parts.join(' ');
        parts.push(
          `C ${tx(view.getFloat32(off, true))} ${ty(view.getFloat32(off + 4, true))} ${tx(view.getFloat32(off + 8, true))} ${ty(view.getFloat32(off + 12, true))} ${tx(view.getFloat32(off + 16, true))} ${ty(view.getFloat32(off + 20, true))}`,
        );
        off += 24;
        break;
      default:
        return parts.join(' ');
    }
  }
  return parts.join(' ');
}

function firstSolidColorHex(paints: FigPaint[] | undefined): string | undefined {
  if (!Array.isArray(paints)) return undefined;
  for (const p of paints) {
    if (p.visible === false) continue;
    if ((p.type === 'SOLID' || !p.type) && p.color) {
      const a = clamp01((p.color.a ?? 1) * (p.opacity ?? 1));
      return figColorToHex({ ...p.color, a });
    }
  }
  return undefined;
}

function buildTextSpans(
  rawChars: string,
  charStyleIds: number[] | undefined,
  overrideTable: FigStyleOverride[] | undefined,
  baseFontSize: number,
): TextSpan[] | undefined {
  if (
    !rawChars ||
    !Array.isArray(charStyleIds) ||
    charStyleIds.length === 0 ||
    !Array.isArray(overrideTable) ||
    overrideTable.length === 0
  ) {
    return undefined;
  }
  const byStyleId = new Map<number, FigStyleOverride>();
  for (const entry of overrideTable) {
    if (typeof entry.styleID === 'number') {
      byStyleId.set(entry.styleID, entry);
    }
  }
  if (byStyleId.size === 0) return undefined;

  const chars = Array.from(rawChars);
  const runs: Array<{ styleId: number; text: string }> = [];
  for (let i = 0; i < chars.length; i++) {
    const sid = charStyleIds[i] ?? 0;
    const prev = runs[runs.length - 1];
    if (prev && prev.styleId === sid) {
      prev.text += chars[i];
    } else {
      runs.push({ styleId: sid, text: chars[i] });
    }
  }

  let hasMeaningfulOverride = false;
  const spans: TextSpan[] = runs.map(({ styleId, text }) => {
    const st = byStyleId.get(styleId);
    if (!st) return { text };
    const fill = firstSolidColorHex(st.fillPaints);
    const fontFamily = st.fontName?.family;
    const fontWeight = mapFigFontStyleToWeight(st.fontName?.style);
    const fontStyle = mapFigFontStyleToItalic(st.fontName?.style);
    const fontSize = typeof st.fontSize === 'number' && st.fontSize > 0 ? st.fontSize : undefined;
    const underline = st.textDecoration === 'UNDERLINE' ? true : undefined;
    const strikethrough = st.textDecoration === 'STRIKETHROUGH' ? true : undefined;
    const textCase =
      st.textCase === 'UPPER'
        ? 'upper'
        : st.textCase === 'LOWER'
          ? 'lower'
          : st.textCase === 'TITLE'
            ? 'title'
            : undefined;
    let letterSpacing: number | undefined;
    if (st.letterSpacing && typeof st.letterSpacing.value === 'number' && st.letterSpacing.value !== 0) {
      const refSize = fontSize ?? baseFontSize;
      letterSpacing =
        st.letterSpacing.units === 'PERCENT'
          ? Number(((st.letterSpacing.value / 100) * refSize).toFixed(2))
          : st.letterSpacing.value;
    }
    if (fill || fontFamily || fontWeight || fontStyle || fontSize || underline || strikethrough || textCase) {
      hasMeaningfulOverride = true;
    }
    return {
      text,
      ...(fill ? { fill } : {}),
      ...(fontFamily ? { fontFamily } : {}),
      ...(fontWeight ? { fontWeight } : {}),
      ...(fontStyle ? { fontStyle } : {}),
      ...(fontSize ? { fontSize } : {}),
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      ...(underline ? { underline } : {}),
      ...(strikethrough ? { strikethrough } : {}),
      ...(textCase ? { textCase } : {}),
    };
  });

  return hasMeaningfulOverride ? spans : undefined;
}

function formatTextWithLists(
  rawChars: string,
  lines: Array<{ lineType?: string; indentationLevel?: number }> | undefined,
): string {
  if (!rawChars || !Array.isArray(lines) || lines.length === 0) return rawChars;
  const hasList = lines.some((l) => l.lineType === 'UNORDERED_LIST' || l.lineType === 'ORDERED_LIST');
  if (!hasList) return rawChars;

  const splitLines = rawChars.split('\n');
  let orderedCounter = 0;
  return splitLines
    .map((lineText, idx) => {
      const meta = lines[idx];
      if (!meta || !lineText.trim()) {
        orderedCounter = 0;
        return lineText;
      }
      const indent = '  '.repeat(Math.max(0, (meta.indentationLevel ?? 1) - 1));
      if (meta.lineType === 'UNORDERED_LIST') {
        orderedCounter = 0;
        return lineText.startsWith('•') ? lineText : `${indent}• ${lineText}`;
      }
      if (meta.lineType === 'ORDERED_LIST') {
        orderedCounter += 1;
        return `${indent}${orderedCounter}. ${lineText}`;
      }
      orderedCounter = 0;
      return lineText;
    })
    .join('\n');
}

function buildGlyphOutlines(
  derivedText: FigDerivedTextData | undefined,
  blobs: FigBlob[],
  baseFontSize: number,
  baseColor: string | undefined,
  charStyleIds: number[] | undefined,
  overrideTable: FigStyleOverride[] | undefined,
): TextGlyphRun[] | undefined {
  const glyphs: FigDerivedGlyph[] | undefined = derivedText?.glyphs;
  if (!Array.isArray(glyphs) || glyphs.length === 0) return undefined;

  const styleColorMap = new Map<number, string>();
  if (Array.isArray(overrideTable)) {
    for (const st of overrideTable) {
      if (typeof st.styleID === 'number') {
        const c = firstSolidColorHex(st.fillPaints);
        if (c) styleColorMap.set(st.styleID, c);
      }
    }
  }

  const pathsByColor = new Map<string, string[]>();
  const defaultKey = '__default__';

  for (const g of glyphs) {
    if (typeof g.commandsBlob !== 'number') continue;
    const blob = blobs[g.commandsBlob];
    if (!blob?.bytes || blob.bytes.byteLength === 0) continue;
    const gx = g.position?.x ?? 0;
    const gy = g.position?.y ?? 0;
    const fSize = typeof g.fontSize === 'number' && g.fontSize > 0 ? g.fontSize : baseFontSize;
    const d = decodeGlyphCommandsToSvgPath(blob.bytes, gx, gy, fSize);
    if (!d) continue;

    let colorKey = defaultKey;
    if (styleColorMap.size > 0) {
      const charIdx = g.firstCharacter;
      const sid =
        typeof g.styleID === 'number'
          ? g.styleID
          : typeof charIdx === 'number' && Array.isArray(charStyleIds)
            ? charStyleIds[charIdx]
            : undefined;
      if (sid !== undefined && styleColorMap.has(sid)) {
        colorKey = styleColorMap.get(sid)!;
      } else if (baseColor) {
        colorKey = baseColor;
      }
    }

    const bucket = pathsByColor.get(colorKey);
    if (bucket) bucket.push(d);
    else pathsByColor.set(colorKey, [d]);
  }

  if (pathsByColor.size === 0) return undefined;
  const runs: TextGlyphRun[] = [];
  for (const [key, parts] of pathsByColor.entries()) {
    runs.push({
      d: parts.join(' '),
      ...(key !== defaultKey ? { fill: key } : {}),
    });
  }
  return runs;
}

function extractStroke(nc: FigNodeChange, ctx: FigImportContext): Stroke | undefined {
  let strokeFills = figPaintsToPenFills(nc.strokePaints, ctx);
  let dashPattern = Array.isArray(nc.dashPattern) && nc.dashPattern.length > 0 ? nc.dashPattern : undefined;
  let weight = nc.strokeWeight;

  // Figma Component Sets (isStateGroup) have a default purple dashed border when no explicit stroke is set
  if (!strokeFills && nc.isStateGroup) {
    strokeFills = [{ type: 'color', color: '#9747ff' }];
    dashPattern = dashPattern ?? [10, 5];
    weight = weight ?? 1.5;
  }

  if (!strokeFills) return undefined;

  let thickness: number | StrokeThickness = weight ?? 1;
  if (nc.borderStrokeWeightsIndependent) {
    const t = nc.borderTopWeight ?? 0;
    const r = nc.borderRightWeight ?? 0;
    const b = nc.borderBottomWeight ?? 0;
    const l = nc.borderLeftWeight ?? 0;
    if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
    thickness = { top: t, right: r, bottom: b, left: l };
  }

  const cap =
    nc.strokeCap === 'ROUND'
      ? 'round'
      : nc.strokeCap === 'SQUARE'
        ? 'square'
        : nc.strokeCap === 'NONE'
          ? 'none'
          : undefined;
  const join =
    nc.strokeJoin === 'ROUND'
      ? 'round'
      : nc.strokeJoin === 'BEVEL'
        ? 'bevel'
        : nc.strokeJoin === 'MITER'
          ? 'miter'
          : undefined;

  return {
    fill: strokeFills,
    thickness,
    align:
      nc.strokeAlign === 'INSIDE'
        ? 'inside'
        : nc.strokeAlign === 'OUTSIDE'
          ? 'outside'
          : 'center',
    ...(cap ? { cap } : {}),
    ...(join ? { join } : {}),
    ...(dashPattern ? { dashPattern } : {}),
  };
}

const FANCY_STROKE_CAPS = new Set([
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED',
  'DIAMOND_FILLED',
  'ROUND_LINE',
]);

function convertFigNodeToPen(
  rawNc: FigNodeChange,
  ctx: FigImportContext,
  idPrefix = '',
  scopedEntries: ScopedOverrideEntry[] = [],
  visitedSymbols: Set<string> = new Set(),
  depth = 0,
): PenNode | null {
  if (depth > 30) return null;
  if (rawNc.phase === 'REMOVED') return null;

  const origId = guidKey(rawNc.guid);
  const matchKeys = getNodeMatchKeys(rawNc);

  // Split scoped override entries into direct hits on this node vs entries for descendants
  let nc: FigNodeChange = rawNc;
  let swappedSymbolId: FigGuid | undefined;
  const childScopedFromOuter: ScopedOverrideEntry[] = [];

  for (const entry of scopedEntries) {
    if (entry.guids.length === 1 && matchKeys.has(entry.guids[0])) {
      nc = mergeNodeWithPatch(nc, entry.patch);
      const maybeSwap = (entry.patch as { overriddenSymbolID?: FigGuid }).overriddenSymbolID;
      if (maybeSwap) swappedSymbolId = maybeSwap;
    } else if (entry.guids.length > 1 && matchKeys.has(entry.guids[0])) {
      childScopedFromOuter.push({ guids: entry.guids.slice(1), patch: entry.patch });
    } else {
      childScopedFromOuter.push(entry);
    }
  }

  let rawChildren = ctx.childrenMap.get(origId) ?? [];
  let nextScopedEntries = childScopedFromOuter;
  let nextVisited = visitedSymbols;
  let nextPrefix = idPrefix;
  const id = idPrefix ? `${idPrefix}__${origId}` : origId;

  // Expand Figma INSTANCE from its master SYMBOL (including swapped symbol IDs) when instance has no direct children
  let instanceScaleX = 1;
  let instanceScaleY = 1;
  let hasInstanceDerivedLayout = false;

  if (nc.type === 'INSTANCE' && rawChildren.length === 0) {
    const effectiveSymGuid = swappedSymbolId ?? nc.symbolData?.symbolID;
    const symKey = effectiveSymGuid ? guidKey(effectiveSymGuid) : '';
    if (symKey && !visitedSymbols.has(symKey)) {
      const masterNode = ctx.byId.get(symKey);
      const masterKids = ctx.childrenMap.get(symKey) ?? [];
      const ownEntries = buildScopedEntriesFromInstance(nc);

      if (masterNode) {
        const masterKeys = getNodeMatchKeys(masterNode);
        // Inherit missing visual & layout properties from master SYMBOL, then apply instance & root overrides
        let mergedInstance: FigNodeChange = {
          ...masterNode,
          ...nc,
          guid: rawNc.guid,
          overrideKey: rawNc.overrideKey,
          type: 'INSTANCE',
          name: nc.name ?? masterNode.name,
          size: nc.size ?? masterNode.size,
          transform: nc.transform ?? masterNode.transform,
          fillPaints: nc.fillPaints ?? masterNode.fillPaints,
          strokePaints: nc.strokePaints ?? masterNode.strokePaints,
          strokeWeight: nc.strokeWeight ?? masterNode.strokeWeight,
          strokeAlign: nc.strokeAlign ?? masterNode.strokeAlign,
          effects: nc.effects ?? masterNode.effects,
          cornerRadius: nc.cornerRadius ?? masterNode.cornerRadius,
          rectangleCornerRadiiIndependent:
            nc.rectangleCornerRadiiIndependent ?? masterNode.rectangleCornerRadiiIndependent,
          rectangleTopLeftCornerRadius:
            nc.rectangleCornerRadiiIndependent !== undefined
              ? nc.rectangleTopLeftCornerRadius
              : (nc.rectangleTopLeftCornerRadius ?? masterNode.rectangleTopLeftCornerRadius),
          rectangleTopRightCornerRadius:
            nc.rectangleCornerRadiiIndependent !== undefined
              ? nc.rectangleTopRightCornerRadius
              : (nc.rectangleTopRightCornerRadius ?? masterNode.rectangleTopRightCornerRadius),
          rectangleBottomRightCornerRadius:
            nc.rectangleCornerRadiiIndependent !== undefined
              ? nc.rectangleBottomRightCornerRadius
              : (nc.rectangleBottomRightCornerRadius ?? masterNode.rectangleBottomRightCornerRadius),
          rectangleBottomLeftCornerRadius:
            nc.rectangleCornerRadiiIndependent !== undefined
              ? nc.rectangleBottomLeftCornerRadius
              : (nc.rectangleBottomLeftCornerRadius ?? masterNode.rectangleBottomLeftCornerRadius),
          clipsContent: nc.clipsContent ?? masterNode.clipsContent,
          frameMaskDisabled: nc.frameMaskDisabled ?? masterNode.frameMaskDisabled,
          stackMode: nc.stackMode ?? masterNode.stackMode,
          stackWrap: nc.stackWrap ?? masterNode.stackWrap,
          stackSpacing: nc.stackSpacing ?? masterNode.stackSpacing,
          stackPadding: nc.stackPadding ?? masterNode.stackPadding,
          stackHorizontalPadding: nc.stackHorizontalPadding ?? masterNode.stackHorizontalPadding,
          stackVerticalPadding: nc.stackVerticalPadding ?? masterNode.stackVerticalPadding,
          stackPaddingRight: nc.stackPaddingRight ?? masterNode.stackPaddingRight,
          stackPaddingBottom: nc.stackPaddingBottom ?? masterNode.stackPaddingBottom,
          stackPrimaryAlignItems: nc.stackPrimaryAlignItems ?? masterNode.stackPrimaryAlignItems,
          stackCounterAlignItems: nc.stackCounterAlignItems ?? masterNode.stackCounterAlignItems,
          layoutGrids: nc.layoutGrids,
        };

        const childOwnEntries: ScopedOverrideEntry[] = [];
        for (const entry of ownEntries) {
          if (entry.guids.length === 1 && masterKeys.has(entry.guids[0])) {
            mergedInstance = mergeNodeWithPatch(mergedInstance, entry.patch);
          } else if (entry.guids.length > 1 && masterKeys.has(entry.guids[0])) {
            childOwnEntries.push({ guids: entry.guids.slice(1), patch: entry.patch });
          } else {
            childOwnEntries.push(entry);
          }
        }
        // Re-apply direct outer overrides targeting this instance so outer instance wins over master root
        for (const entry of scopedEntries) {
          if (entry.guids.length === 1 && matchKeys.has(entry.guids[0])) {
            mergedInstance = mergeNodeWithPatch(mergedInstance, entry.patch);
          }
        }
        nc = mergedInstance;

        hasInstanceDerivedLayout =
          (Array.isArray(nc.derivedSymbolData) && nc.derivedSymbolData.length > 0) ||
          (nc.stackMode !== undefined && nc.stackMode !== 'NONE');

        if (masterKids.length > 0) {
          rawChildren = masterKids;
          nextVisited = new Set(visitedSymbols);
          nextVisited.add(symKey);
          nextPrefix = id;
          nextScopedEntries = [...childOwnEntries, ...childScopedFromOuter];

          const mw = masterNode.size?.x ?? 0;
          const mh = masterNode.size?.y ?? 0;
          const iw = nc.size?.x ?? 0;
          const ih = nc.size?.y ?? 0;
          if (!hasInstanceDerivedLayout && mw > 0 && mh > 0 && iw > 0 && ih > 0) {
            instanceScaleX = iw / mw;
            instanceScaleY = ih / mh;
          }
        }
      }
    }
  }

  const width = nc.size?.x ?? 0;
  const height = nc.size?.y ?? 0;

  // Extract position, rotation, and reflection (flipX / flipY) from Figma's 2x3 affine transform matrix
  const m00 = nc.transform?.m00 ?? 1;
  const m01 = nc.transform?.m01 ?? 0;
  const m02 = nc.transform?.m02 ?? 0;
  const m10 = nc.transform?.m10 ?? 0;
  const m11 = nc.transform?.m11 ?? 1;
  const m12 = nc.transform?.m12 ?? 0;
  const det = m00 * m11 - m01 * m10;
  const isFlipped = det < 0;
  const hasExtent = width > 0 || height > 0;

  let x = m02;
  let y = m12;
  let rotation: number | undefined;
  let flipX: boolean | undefined;
  let flipY: boolean | undefined;

  if (hasExtent) {
    if (isFlipped) {
      // Pure vertical flip check: m00 ≈ 1, m11 ≈ -1, m01 ≈ 0, m10 ≈ 0
      if (Math.abs(m00 - 1) < 1e-3 && Math.abs(m11 + 1) < 1e-3 && Math.abs(m01) < 1e-3 && Math.abs(m10) < 1e-3) {
        flipY = true;
      } else {
        // Decompose general reflection as rotate(deg) * scale(-1, 1) around center
        flipX = true;
        const rad = Math.atan2(-m10, -m00);
        if (Math.abs(rad) > 1e-3) {
          rotation = Number(((-rad * 180) / Math.PI).toFixed(2));
        }
      }
    } else {
      const rad = Math.atan2(m10, m00);
      if (Math.abs(rad) > 1e-3) {
        rotation = Number(((-rad * 180) / Math.PI).toFixed(2));
      }
    }

    if (rotation !== undefined || flipX || flipY) {
      // Figma transforms around local top-left (0, 0); OpenPenViewer rotates/flips around center (x + w/2, y + h/2)
      const cx = m00 * (width / 2) + m01 * (height / 2) + m02;
      const cy = m10 * (width / 2) + m11 * (height / 2) + m12;
      x = cx - width / 2;
      y = cy - height / 2;
    }
  }

  const fills = figPaintsToPenFills(nc.fillPaints, ctx);
  const stroke = extractStroke(nc, ctx);
  const effects = figEffectsToPen(nc.effects);
  const cornerRadius = extractCornerRadius(nc);
  const blendMode = mapFigBlendMode(nc.blendMode);
  const maskType: 'alpha' | 'outline' | 'luminance' | undefined = nc.mask
    ? nc.maskType === 'OUTLINE' || nc.maskType === 'VECTOR'
      ? 'outline'
      : nc.maskType === 'LUMINANCE'
        ? 'luminance'
        : 'alpha'
    : undefined;

  const base = {
    id,
    name: nc.name,
    x,
    y,
    ...(rotation !== undefined ? { rotation } : {}),
    ...(flipX ? { flipX: true } : {}),
    ...(flipY ? { flipY: true } : {}),
    ...(nc.visible === false ? { enabled: false } : {}),
    ...(nc.opacity !== undefined && nc.opacity < 1 ? { opacity: nc.opacity } : {}),
    ...(blendMode ? { blendMode } : {}),
    ...(nc.mask ? { mask: true, ...(maskType ? { maskType } : {}) } : {}),
    ...(nc.stackPositioning === 'ABSOLUTE' ? { layoutPosition: 'absolute' as const } : {}),
  };

  const rawChildNodes = rawChildren
    .map((child) =>
      convertFigNodeToPen(child, ctx, nextPrefix, nextScopedEntries, nextVisited, depth + 1),
    )
    .filter((n): n is PenNode => n !== null);

  // Only scale pure non-layout vector/group symbol instances lacking derivedSymbolData
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
      const isWrapped = nc.stackWrap === 'WRAP';
      const hasComplexFlexChild = rawChildren.some((c) => {
        const cr = c as Record<string, unknown>;
        return (
          (typeof cr.stackChildPrimaryGrow === 'number' && cr.stackChildPrimaryGrow > 0) ||
          cr.stackChildAlignSelf === 'STRETCH'
        );
      });
      const layout =
        nc.type === 'SECTION' || isWrapped || hasComplexFlexChild
          ? 'none'
          : nc.stackMode === 'HORIZONTAL'
            ? 'horizontal'
            : nc.stackMode === 'VERTICAL'
              ? 'vertical'
              : 'none';
      const clip =
        typeof nc.frameMaskDisabled === 'boolean'
          ? !nc.frameMaskDisabled
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
      const layoutGrids = nc.type === 'INSTANCE' ? undefined : mapFigLayoutGrids(nc.layoutGrids);

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
        ...(nc.type === 'SECTION' ? { isSection: true } : {}),
        layout,
        ...(ctx.preserveLayoutPositions && layout !== 'none'
          ? { layoutPreservePositions: true }
          : {}),
        ...(nc.stackSpacing ? { gap: nc.stackSpacing } : {}),
        ...(padding ? { padding } : {}),
        ...(mapStackAlign(nc.stackPrimaryAlignItems)
          ? { justifyContent: mapStackAlign(nc.stackPrimaryAlignItems) }
          : {}),
        ...(mapStackAlign(nc.stackCounterAlignItems)
          ? { alignItems: mapStackAlign(nc.stackCounterAlignItems) }
          : {}),
        ...(layoutGrids ? { layoutGrids } : {}),
        children: childNodes,
      } as PenNode;
    }

    case 'GROUP':
      return {
        ...base,
        type: 'group',
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        ...(effects ? { effect: effects } : {}),
        children: childNodes,
      } as PenNode;

    case 'BOOLEAN_OPERATION': {
      const fillGeom = extractGeometryItemsPath(nc.fillGeometry, ctx);
      const strokeGeom = stroke?.fill ? extractGeometryItemsPath(nc.strokeGeometry, ctx) : null;

      if (fillGeom && fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'group',
          ...(width > 0 ? { width } : {}),
          ...(height > 0 ? { height } : {}),
          ...(effects ? { effect: effects } : {}),
          children: [
            {
              type: 'path',
              id: `${id}__fill`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: fillGeom.path,
              ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
              fill: fills.length === 1 ? fills[0] : fills,
            } as PenNode,
            {
              type: 'path',
              id: `${id}__stroke`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: strokeGeom.path,
              ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
              fill: stroke.fill,
            } as PenNode,
          ],
        } as PenNode;
      }

      if (!fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: strokeGeom.path,
          ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
          fill: stroke.fill,
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      if (fillGeom) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: fillGeom.path,
          ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
          ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
          ...(stroke ? { stroke } : {}),
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      if (childNodes.length >= 2) {
        const rawOp = String(nc.booleanOperation ?? 'UNION').toUpperCase();
        const boolOp: BoolOp =
          rawOp === 'SUBTRACT' || rawOp === 'DIFFERENCE'
            ? 'subtract'
            : rawOp === 'INTERSECT'
              ? 'intersect'
              : rawOp === 'XOR' || rawOp === 'EXCLUDE'
                ? 'exclude'
                : 'union';
        const computed = booleanOperation(childNodes, boolOp);
        if (computed && computed.type === 'path' && computed.geometry) {
          return {
            ...base,
            type: 'path',
            x: base.x + (computed.x ?? 0),
            y: base.y + (computed.y ?? 0),
            width: typeof computed.width === 'number' ? computed.width : width,
            height: typeof computed.height === 'number' ? computed.height : height,
            geometry: computed.geometry,
            fillRule: 'evenodd',
            ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
            ...(stroke ? { stroke } : {}),
            ...(effects ? { effect: effects } : {}),
          } as PenNode;
        }
      }

      return {
        ...base,
        type: 'group',
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        ...(effects ? { effect: effects } : {}),
        children: childNodes,
      } as PenNode;
    }

    case 'ELLIPSE': {
      let startAngle: number | undefined;
      let sweepAngle: number | undefined;
      let innerRadius: number | undefined;
      if (nc.arcData) {
        const ir = nc.arcData.innerRadius ?? 0;
        if (ir > 0.001) innerRadius = Number(clamp01(ir).toFixed(4));
        const a0 = nc.arcData.startingAngle ?? 0;
        const a1 = nc.arcData.endingAngle ?? Math.PI * 2;
        const sweepRad = a1 - a0;
        if (Math.abs(Math.abs(sweepRad) - Math.PI * 2) > 0.01) {
          startAngle = Number(((a0 * 180) / Math.PI).toFixed(2));
          sweepAngle = Number(((sweepRad * 180) / Math.PI).toFixed(2));
        }
      }
      return {
        ...base,
        type: 'ellipse',
        width,
        height,
        ...(innerRadius !== undefined ? { innerRadius } : {}),
        ...(startAngle !== undefined ? { startAngle } : {}),
        ...(sweepAngle !== undefined ? { sweepAngle } : {}),
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
    }

    case 'LINE':
      return {
        ...base,
        type: 'line',
        width,
        height,
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;

    case 'REGULAR_POLYGON':
    case 'STAR': {
      const fillGeom = extractGeometryItemsPath(nc.fillGeometry, ctx);
      const strokeGeom = stroke?.fill ? extractGeometryItemsPath(nc.strokeGeometry, ctx) : null;

      if (fillGeom && fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'group',
          ...(width > 0 ? { width } : {}),
          ...(height > 0 ? { height } : {}),
          ...(effects ? { effect: effects } : {}),
          children: [
            {
              type: 'path',
              id: `${id}__fill`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: fillGeom.path,
              ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
              fill: fills.length === 1 ? fills[0] : fills,
            } as PenNode,
            {
              type: 'path',
              id: `${id}__stroke`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: strokeGeom.path,
              ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
              fill: stroke.fill,
            } as PenNode,
          ],
        } as PenNode;
      }

      if (!fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: strokeGeom.path,
          ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
          fill: stroke.fill,
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      if (fillGeom) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: fillGeom.path,
          ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
          ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
          ...(stroke ? { stroke } : {}),
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }
      const innerScale =
        nc.type === 'STAR' && typeof nc.starInnerScale === 'number'
          ? clamp01(nc.starInnerScale)
          : undefined;
      return {
        ...base,
        type: 'polygon',
        width,
        height,
        polygonCount: nc.count ?? (nc.type === 'STAR' ? 5 : 3),
        ...(innerScale !== undefined ? { innerRadius: innerScale } : {}),
        ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
        ...(stroke ? { stroke } : {}),
        ...(effects ? { effect: effects } : {}),
      } as PenNode;
    }

    case 'TEXT': {
      const textFill = fills?.[0];
      const weight = mapFigFontStyleToWeight(nc.fontName?.style);
      const italic = mapFigFontStyleToItalic(nc.fontName?.style);
      const autoResize = nc.textAutoResize;
      const textGrowth =
        autoResize === 'WIDTH_AND_HEIGHT'
          ? 'auto'
          : autoResize === 'HEIGHT'
            ? 'fixed-width'
            : autoResize === 'NONE'
              ? 'fixed-width-height'
              : undefined;
      const fontSize = nc.fontSize ?? 16;
      const lhObj = nc.lineHeight;
      let lineHeight: number | undefined;
      if (lhObj && typeof lhObj.value === 'number' && Number.isFinite(lhObj.value) && lhObj.value > 0) {
        if (lhObj.units === 'PIXELS') lineHeight = Number((lhObj.value / fontSize).toFixed(3));
        else if (lhObj.units === 'PERCENT') lineHeight = Number((lhObj.value / 100).toFixed(3));
        else if (lhObj.units === 'RAW') lineHeight = lhObj.value;
      }
      const lsObj = nc.letterSpacing;
      let letterSpacing: number | undefined;
      if (lsObj && typeof lsObj.value === 'number' && Number.isFinite(lsObj.value) && lsObj.value !== 0) {
        letterSpacing =
          lsObj.units === 'PERCENT'
            ? Number(((lsObj.value / 100) * fontSize).toFixed(2))
            : lsObj.value;
      }
      const textCase =
        nc.textCase === 'UPPER'
          ? 'upper'
          : nc.textCase === 'LOWER'
            ? 'lower'
            : nc.textCase === 'TITLE'
              ? 'title'
              : undefined;
      const textAlignVertical =
        nc.textAlignVertical === 'CENTER'
          ? 'middle'
          : nc.textAlignVertical === 'BOTTOM'
            ? 'bottom'
            : nc.textAlignVertical === 'TOP'
              ? 'top'
              : undefined;
      const underline = nc.textDecoration === 'UNDERLINE' ? true : undefined;
      const strikethrough = nc.textDecoration === 'STRIKETHROUGH' ? true : undefined;
      const paragraphSpacing =
        typeof nc.paragraphSpacing === 'number' && nc.paragraphSpacing > 0
          ? nc.paragraphSpacing
          : undefined;

      const rawChars = nc.textData?.characters ?? nc.name ?? '';
      const formattedContent = formatTextWithLists(rawChars, nc.textData?.lines);
      const spans = buildTextSpans(
        rawChars,
        nc.textData?.characterStyleIDs,
        nc.textData?.styleOverrideTable,
        fontSize,
      );
      const baseHex = firstSolidColorHex(nc.fillPaints);
      const glyphOutlines = buildGlyphOutlines(
        nc.derivedTextData,
        ctx.blobs,
        fontSize,
        baseHex,
        nc.textData?.characterStyleIDs,
        nc.textData?.styleOverrideTable,
      );

      return {
        ...base,
        type: 'text',
        width,
        height,
        content: formattedContent,
        fontSize,
        ...(nc.fontName?.family ? { fontFamily: nc.fontName.family } : {}),
        ...(weight ? { fontWeight: weight } : {}),
        ...(italic ? { fontStyle: italic } : {}),
        ...(lineHeight !== undefined ? { lineHeight } : {}),
        ...(letterSpacing !== undefined ? { letterSpacing } : {}),
        ...(paragraphSpacing !== undefined ? { paragraphSpacing } : {}),
        ...(underline ? { underline } : {}),
        ...(strikethrough ? { strikethrough } : {}),
        ...(textGrowth ? { textGrowth } : {}),
        ...(textCase ? { textCase } : {}),
        ...(nc.textAlignHorizontal
          ? { textAlign: nc.textAlignHorizontal.toLowerCase() }
          : {}),
        ...(textAlignVertical ? { textAlignVertical } : {}),
        ...(textFill ? { fill: textFill } : {}),
        ...(effects ? { effect: effects } : {}),
        ...(spans ? { spans } : {}),
        ...(glyphOutlines ? { glyphOutlines } : {}),
      } as PenNode;
    }

    case 'VECTOR':
    case 'BRUSH': {
      // Multi-region vector networks with per-region fill overrides in vectorData.styleOverrideTable
      const styleTable = nc.vectorData?.styleOverrideTable;
      if (
        Array.isArray(nc.fillGeometry) &&
        nc.fillGeometry.length > 1 &&
        Array.isArray(styleTable) &&
        styleTable.some((s) => Array.isArray(s.fillPaints) && s.fillPaints.length > 0)
      ) {
        const styleFills = new Map<number, Fill[]>();
        for (const st of styleTable) {
          if (typeof st.styleID === 'number' && st.fillPaints) {
            const pf = figPaintsToPenFills(st.fillPaints, ctx);
            if (pf) styleFills.set(st.styleID, pf);
          }
        }
        if (styleFills.size > 0) {
          const regionPaths: PenNode[] = [];
          nc.fillGeometry.forEach((fg, idx) => {
            if (typeof fg.commandsBlob !== 'number') return;
            const d = getCachedBlobSvgPath(fg.commandsBlob, ctx);
            if (!d) return;
            const regionFill =
              (typeof fg.styleID === 'number' ? styleFills.get(fg.styleID) : undefined) ?? fills;
            regionPaths.push({
              type: 'path',
              id: `${id}__r${idx}`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: d,
              ...(fg.windingRule === 'EVENODD' || fg.windingRule === 'ODD'
                ? { fillRule: 'evenodd' }
                : {}),
              ...(regionFill ? { fill: regionFill.length === 1 ? regionFill[0] : regionFill } : {}),
              ...(idx === nc.fillGeometry!.length - 1 && stroke ? { stroke } : {}),
            } as PenNode);
          });
          if (regionPaths.length > 0) {
            return {
              ...base,
              type: 'group',
              ...(width > 0 ? { width } : {}),
              ...(height > 0 ? { height } : {}),
              ...(effects ? { effect: effects } : {}),
              children: regionPaths,
            } as PenNode;
          }
        }
      }

      const fillGeom = extractGeometryItemsPath(nc.fillGeometry, ctx);
      const strokeGeom = stroke?.fill ? extractGeometryItemsPath(nc.strokeGeometry, ctx) : null;

      if (fillGeom && fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'group',
          ...(width > 0 ? { width } : {}),
          ...(height > 0 ? { height } : {}),
          ...(effects ? { effect: effects } : {}),
          children: [
            {
              type: 'path',
              id: `${id}__fill`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: fillGeom.path,
              ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
              fill: fills.length === 1 ? fills[0] : fills,
            } as PenNode,
            {
              type: 'path',
              id: `${id}__stroke`,
              x: 0,
              y: 0,
              width,
              height,
              geometry: strokeGeom.path,
              ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
              fill: stroke.fill,
            } as PenNode,
          ],
        } as PenNode;
      }

      const isUniformRoundStroke =
        !fills &&
        nc.type !== 'BRUSH' &&
        (nc.strokeAlign === undefined || nc.strokeAlign === 'CENTER') &&
        nc.strokeCap === 'ROUND' &&
        nc.strokeJoin === 'ROUND' &&
        nc.vectorData?.vectorNetworkBlob !== undefined &&
        !(
          Array.isArray(styleTable) &&
          styleTable.some(
            (s) =>
              (s.strokeCap !== undefined && s.strokeCap !== 'ROUND') ||
              (s.strokeJoin !== undefined && s.strokeJoin !== 'ROUND'),
          )
        );

      if (isUniformRoundStroke) {
        const roundNetPath = extractVectorNetworkPath(nc, ctx.blobs, width, height);
        if (roundNetPath) {
          return {
            ...base,
            type: 'path',
            width,
            height,
            geometry: roundNetPath,
            ...(stroke ? { stroke } : {}),
            ...(effects ? { effect: effects } : {}),
          } as PenNode;
        }
      }

      if (!fills && strokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: strokeGeom.path,
          ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
          fill: stroke.fill,
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      if (fillGeom) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: fillGeom.path,
          ...(fillGeom.fillRule ? { fillRule: fillGeom.fillRule } : {}),
          ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
          ...(stroke ? { stroke } : {}),
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      // Use baked strokeGeometry when arrowheads, brushes, or stroke-only outlines have no vectorNetwork
      const wantsBakedStroke =
        nc.type === 'BRUSH' ||
        (nc.strokeCap !== undefined && FANCY_STROKE_CAPS.has(nc.strokeCap)) ||
        nc.vectorData?.vectorNetworkBlob === undefined;
      if (wantsBakedStroke) {
        const strokeGeom = extractGeometryItemsPath(nc.strokeGeometry, ctx);
        if (strokeGeom && stroke?.fill) {
          return {
            ...base,
            type: 'path',
            width,
            height,
            geometry: strokeGeom.path,
            ...(strokeGeom.fillRule ? { fillRule: strokeGeom.fillRule } : {}),
            fill: stroke.fill,
            ...(effects ? { effect: effects } : {}),
          } as PenNode;
        }
      }

      const netPath = extractVectorNetworkPath(nc, ctx.blobs, width, height);
      if (netPath) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: netPath,
          ...(fills ? { fill: fills.length === 1 ? fills[0] : fills } : {}),
          ...(stroke ? { stroke } : {}),
          ...(effects ? { effect: effects } : {}),
        } as PenNode;
      }

      const fallbackStrokeGeom = extractGeometryItemsPath(nc.strokeGeometry, ctx);
      if (fallbackStrokeGeom && stroke?.fill) {
        return {
          ...base,
          type: 'path',
          width,
          height,
          geometry: fallbackStrokeGeom.path,
          ...(fallbackStrokeGeom.fillRule ? { fillRule: fallbackStrokeGeom.fillRule } : {}),
          fill: stroke.fill,
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
    (nc) => nc.phase !== 'REMOVED' && nc.type !== 'VARIABLE' && nc.type !== 'VARIABLE_SET',
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

  const sortByParentPosition = (list: FigNodeChange[]) => {
    list.sort((a, b) => {
      const pa = a.parentIndex?.position ?? '';
      const pb = b.parentIndex?.position ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  };

  for (const list of childrenMap.values()) {
    sortByParentPosition(list);
  }

  // Real Figma desktop/web exports have version >= 20 (e.g. v106) with exact pre-computed node transforms;
  // synthetic round-trip exports built by penToFig use version === 15.
  const ctx: FigImportContext = {
    byId,
    childrenMap,
    blobs,
    blobPathCache: new Map(),
    images: parsed.images ?? {},
    imageUrlCache: new Map(),
    preserveLayoutPositions: parsed.version !== 15,
  };

  const allCanvases = nodeChanges.filter((nc) => nc.type === 'CANVAS');
  sortByParentPosition(allCanvases);

  const visibleCanvases = allCanvases.filter((c) => {
    if (c.internalOnly === true) return false;
    if (c.isPageDivider === true) return false;
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
      const background =
        canvas.backgroundEnabled !== false && canvas.backgroundColor
          ? figColorToHex(canvas.backgroundColor)
          : undefined;
      return {
        id: cid,
        name: (canvas.name ?? '').trim() || `Page ${idx + 1}`,
        children,
        ...(background ? { background } : {}),
      };
    });

    const activePage = pages.find((p) => p.children.length > 0) ?? pages[0];
    if (pages.length > 1) {
      return {
        version: '1.0',
        children: activePage.children,
        ...(activePage.background ? { background: activePage.background } : {}),
        pages,
        activePageId: activePage.id,
      };
    }
    return {
      version: '1.0',
      children: activePage.children,
      ...(activePage.background ? { background: activePage.background } : {}),
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
      } else if (Array.isArray(cornerRadius) && cornerRadius.length === 4) {
        nc.rectangleCornerRadiiIndependent = true;
        nc.rectangleTopLeftCornerRadius = safeNum(cornerRadius[0], 0);
        nc.rectangleTopRightCornerRadius = safeNum(cornerRadius[1], 0);
        nc.rectangleBottomRightCornerRadius = safeNum(cornerRadius[2], 0);
        nc.rectangleBottomLeftCornerRadius = safeNum(cornerRadius[3], 0);
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
