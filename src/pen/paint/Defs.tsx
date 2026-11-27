/**
 * <defs> セクション。PaintRegistry が集めたグラデーション / フィルタを
 * ドキュメント 1 回だけ出力する。
 */

import type { GradientFill, ImageFill, MeshGradientFill } from '../types';
import type { PaintRegistry, PaintRef, FilterRef } from './registry';

export function Defs({ registry }: { registry: PaintRegistry }) {
  if (registry.paints.length === 0 && registry.filters.length === 0) return null;
  return (
    <defs>
      {registry.paints.map((p) => renderPaint(p))}
      {registry.filters.map((f) => renderFilter(f))}
    </defs>
  );
}

/** 安全な画像 URL のみ許可し、javascript: / data:text/html 等を排除 */
function sanitizeImageUrl(url: string): string | null {
  if (/^data:image\/[a-z+]+;base64,/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:') {
      return url;
    }
  } catch {
    // invalid URL
  }
  return null;
}

function renderPaint(p: PaintRef) {
  if (p.kind === 'gradient') return renderGradient(p.id, p.def as GradientFill);
  if (p.kind === 'mesh') return renderMeshGradient(p.id, p.def as MeshGradientFill);

  const def = p.def as ImageFill;
  const safeUrl = sanitizeImageUrl(def.url);
  if (!safeUrl) return null;

  if (def.mode === 'tile') {
    const scale = typeof def.tileScale === 'number' && def.tileScale > 0 ? def.tileScale : 1;
    const tileW = Math.max(1, (def.originalWidth ?? p.width ?? 64) * scale);
    const tileH = Math.max(1, (def.originalHeight ?? p.height ?? 64) * scale);
    return (
      <pattern
        key={p.id}
        id={p.id}
        patternUnits="userSpaceOnUse"
        width={tileW}
        height={tileH}
      >
        <image
          href={safeUrl}
          x={0}
          y={0}
          width={tileW}
          height={tileH}
          preserveAspectRatio="none"
        />
      </pattern>
    );
  }

  if (def.mode === 'crop' && Array.isArray(def.imageTransform) && def.imageTransform.length === 6) {
    const [a, b, c, d, e, f] = def.imageTransform;
    const W = typeof p.width === 'number' && p.width > 0 ? p.width : 100;
    const H = typeof p.height === 'number' && p.height > 0 ? p.height : 100;
    const mat = `matrix(${a} ${b * (H / W)} ${c * (W / H)} ${d} ${e * W} ${f * H})`;
    return (
      <pattern
        key={p.id}
        id={p.id}
        patternUnits="objectBoundingBox"
        width={1}
        height={1}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        <image
          href={safeUrl}
          x={0}
          y={0}
          width={W}
          height={H}
          preserveAspectRatio="none"
          transform={mat}
        />
      </pattern>
    );
  }

  const preserve = def.mode === 'stretch'
    ? 'none'
    : def.mode === 'fit'
    ? 'xMidYMid meet'
    : 'xMidYMid slice';
  const hasSize = typeof p.width === 'number' && p.width > 0 && typeof p.height === 'number' && p.height > 0;
  if (hasSize) {
    return (
      <pattern
        key={p.id}
        id={p.id}
        patternUnits="objectBoundingBox"
        width={1}
        height={1}
        viewBox={`0 0 ${p.width} ${p.height}`}
        preserveAspectRatio="none"
      >
        <image
          href={safeUrl}
          x={0}
          y={0}
          width={p.width}
          height={p.height}
          preserveAspectRatio={preserve}
        />
      </pattern>
    );
  }
  return (
    <pattern
      key={p.id}
      id={p.id}
      patternUnits="objectBoundingBox"
      patternContentUnits="objectBoundingBox"
      width={1}
      height={1}
    >
      <image
        href={safeUrl}
        preserveAspectRatio={preserve}
        width={1}
        height={1}
      />
    </pattern>
  );
}

function renderMeshGradient(id: string, def: MeshGradientFill) {
  const cols = Math.max(1, def.columns ?? 1);
  const rows = Math.max(1, def.rows ?? 1);
  const colors = def.colors ?? [];
  if (colors.length === 0) {
    return <linearGradient key={id} id={id} />;
  }
  const topLeft = colors[0];
  const topRight = colors[cols - 1] ?? colors[colors.length - 1];
  const bottomRight = colors[colors.length - 1];
  const bottomLeft = colors[(rows - 1) * cols] ?? colors[colors.length - 1];
  return (
    <linearGradient key={id} id={id} x1={0} y1={0} x2={0} y2={1}>
      <stop offset="0" stopColor={topLeft} />
      <stop offset={0.5} stopColor={mixColors(topRight, bottomLeft)} />
      <stop offset="1" stopColor={bottomRight} />
    </linearGradient>
  );
}

function mixColors(a: string, b: string): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const r = Math.round((pa.r + pb.r) / 2);
  const g = Math.round((pa.g + pb.g) / 2);
  const bl = Math.round((pa.b + pb.b) / 2);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function renderGradient(id: string, def: GradientFill) {
  const type = def.gradientType ?? 'linear';
  const stops = (def.colors ?? []).map((c, i) => (
    <stop key={i} offset={c.position} stopColor={c.color} />
  ));
  if (type === 'linear') {
    if (def.start && def.end && typeof def.start.x === 'number' && typeof def.start.y === 'number' && typeof def.end.x === 'number' && typeof def.end.y === 'number') {
      return (
        <linearGradient
          key={id}
          id={id}
          x1={def.start.x}
          y1={def.start.y}
          x2={def.end.x}
          y2={def.end.y}
        >
          {stops}
        </linearGradient>
      );
    }
    const rad = ((def.rotation ?? 0) + 180) * (Math.PI / 180);
    const dx = Math.sin(rad) / 2;
    const dy = -Math.cos(rad) / 2;
    return (
      <linearGradient
        key={id}
        id={id}
        x1={0.5 - dx}
        y1={0.5 - dy}
        x2={0.5 + dx}
        y2={0.5 + dy}
      >
        {stops}
      </linearGradient>
    );
  }
  if (type === 'radial') {
    if (Array.isArray(def.transform) && def.transform.length === 6) {
      return (
        <radialGradient
          key={id}
          id={id}
          cx={0.5}
          cy={0.5}
          r={0.5}
          gradientTransform={`matrix(${def.transform.join(' ')})`}
        >
          {stops}
        </radialGradient>
      );
    }
    const cx = def.center?.x ?? 0.5;
    const cy = def.center?.y ?? 0.5;
    const r = Math.max(def.size?.width ?? 0.5, def.size?.height ?? 0.5);
    return (
      <radialGradient key={id} id={id} cx={cx} cy={cy} r={r}>
        {stops}
      </radialGradient>
    );
  }
  return (
    <linearGradient key={id} id={id}>
      {stops}
    </linearGradient>
  );
}

function renderFilter(f: FilterRef) {
  return (
    <filter
      key={f.id}
      id={f.id}
      {...(f.zeroExtent
        ? { filterUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 }
        : { x: '-50%', y: '-50%', width: '200%', height: '200%' })}
    >
      {f.effects.flatMap((e, i) => {
        if (e.type === 'blur') {
          return [<feGaussianBlur key={`b-${i}`} in="SourceGraphic" stdDeviation={e.radius ?? 4} />];
        }
        const dx = e.offset?.x ?? 0;
        const dy = e.offset?.y ?? 0;
        const blur = e.blur ?? 4;
        const color = e.color ?? '#00000040';
        if (e.shadowType === 'inner') {
          const id = `${f.id}-inner-${i}`;
          return [
            <feColorMatrix
              key={`${id}-inv`}
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1 1"
              result={`${id}-inv`}
            />,
            <feGaussianBlur key={`${id}-blur`} in={`${id}-inv`} stdDeviation={blur} result={`${id}-blur`} />,
            <feOffset key={`${id}-off`} in={`${id}-blur`} dx={dx} dy={dy} result={`${id}-off`} />,
            <feComposite
              key={`${id}-inside`}
              in={`${id}-off`}
              in2="SourceAlpha"
              operator="in"
              result={`${id}-inside`}
            />,
            <feFlood key={`${id}-flood`} floodColor={color} result={`${id}-color`} />,
            <feComposite
              key={`${id}-colorIn`}
              in={`${id}-color`}
              in2={`${id}-inside`}
              operator="in"
              result={`${id}-shadow`}
            />,
            <feComposite
              key={`${id}-over`}
              in={`${id}-shadow`}
              in2="SourceGraphic"
              operator="over"
            />,
          ];
        }
        return [
          <feDropShadow key={`ds-${i}`} dx={dx} dy={dy} stdDeviation={blur} floodColor={color} />,
        ];
      })}
    </filter>
  );
}
