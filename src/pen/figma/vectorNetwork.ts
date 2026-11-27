import type { LucideIconData } from '../renderer/lucideIcons';

interface Vec2 {
  x: number;
  y: number;
}

interface Segment {
  start: number;
  end: number;
  dxStart: number;
  dyStart: number;
  dxEnd: number;
  dyEnd: number;
}

interface VectorBuilder {
  vertices: Vec2[];
  segments: Segment[];
  loops: number[][];
}

function createBuilder(): VectorBuilder {
  return { vertices: [], segments: [], loops: [] };
}

function addVertex(b: VectorBuilder, x: number, y: number): number {
  b.vertices.push({ x, y });
  return b.vertices.length - 1;
}

function addLineSeg(b: VectorBuilder, start: number, end: number): number {
  b.segments.push({ start, end, dxStart: 0, dyStart: 0, dxEnd: 0, dyEnd: 0 });
  return b.segments.length - 1;
}

function addCubicSeg(
  b: VectorBuilder,
  start: number,
  end: number,
  cp1: Vec2,
  cp2: Vec2,
): number {
  const p0 = b.vertices[start];
  const p3 = b.vertices[end];
  b.segments.push({
    start,
    end,
    dxStart: cp1.x - p0.x,
    dyStart: cp1.y - p0.y,
    dxEnd: cp2.x - p3.x,
    dyEnd: cp2.y - p3.y,
  });
  return b.segments.length - 1;
}

const TOKEN_RE = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Parses an SVG path `d` string into Figma vectorNetwork vertices, cubic/line segments, and closed loops.
 */
export function parseSvgPathToBuilder(
  d: string,
  b: VectorBuilder,
  scaleX = 1,
  scaleY = 1,
  closeLoopsAsRegions = false,
): void {
  const tokens = d.match(TOKEN_RE);
  if (!tokens || tokens.length === 0) return;

  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let startIdx = -1;
  let curIdx = -1;
  let lastCp: Vec2 | null = null;
  let currentLoop: number[] = [];

  const isNum = (tok: string | undefined) => tok !== undefined && !/^[a-zA-Z]$/.test(tok);
  const nextNum = () => parseFloat(tokens[i++] ?? '0');

  const finishLoop = (closed: boolean) => {
    if (closed && closeLoopsAsRegions && currentLoop.length > 0) {
      b.loops.push(currentLoop);
    }
    currentLoop = [];
  };

  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok;
      i++;
    } else if (!cmd) {
      break;
    }

    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      if (curIdx !== -1 && startIdx !== -1 && curIdx !== startIdx) {
        const segIdx = addLineSeg(b, curIdx, startIdx);
        currentLoop.push(segIdx);
      }
      finishLoop(true);
      cx = sx;
      cy = sy;
      curIdx = startIdx;
      lastCp = null;
      continue;
    }

    if (upper === 'M') {
      finishLoop(false);
      const nx = nextNum() + (rel ? cx : 0);
      const ny = nextNum() + (rel ? cy : 0);
      cx = nx;
      cy = ny;
      sx = nx;
      sy = ny;
      startIdx = addVertex(b, nx * scaleX, ny * scaleY);
      curIdx = startIdx;
      lastCp = null;
      // Subsequent coordinate pairs after M are implicit L/l
      cmd = rel ? 'l' : 'L';
      continue;
    }

    if (upper === 'L') {
      while (isNum(tokens[i])) {
        const nx = nextNum() + (rel ? cx : 0);
        const ny = nextNum() + (rel ? cy : 0);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, nx * scaleX, ny * scaleY);
        currentLoop.push(addLineSeg(b, curIdx, nextIdx));
        cx = nx;
        cy = ny;
        curIdx = nextIdx;
        lastCp = null;
      }
      continue;
    }

    if (upper === 'H') {
      while (isNum(tokens[i])) {
        const nx = nextNum() + (rel ? cx : 0);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, nx * scaleX, cy * scaleY);
        currentLoop.push(addLineSeg(b, curIdx, nextIdx));
        cx = nx;
        curIdx = nextIdx;
        lastCp = null;
      }
      continue;
    }

    if (upper === 'V') {
      while (isNum(tokens[i])) {
        const ny = nextNum() + (rel ? cy : 0);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, cx * scaleX, ny * scaleY);
        currentLoop.push(addLineSeg(b, curIdx, nextIdx));
        cy = ny;
        curIdx = nextIdx;
        lastCp = null;
      }
      continue;
    }

    if (upper === 'C') {
      while (isNum(tokens[i])) {
        const x1 = nextNum() + (rel ? cx : 0);
        const y1 = nextNum() + (rel ? cy : 0);
        const x2 = nextNum() + (rel ? cx : 0);
        const y2 = nextNum() + (rel ? cy : 0);
        const nx = nextNum() + (rel ? cx : 0);
        const ny = nextNum() + (rel ? cy : 0);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, nx * scaleX, ny * scaleY);
        currentLoop.push(
          addCubicSeg(
            b,
            curIdx,
            nextIdx,
            { x: x1 * scaleX, y: y1 * scaleY },
            { x: x2 * scaleX, y: y2 * scaleY },
          ),
        );
        lastCp = { x: x2, y: y2 };
        cx = nx;
        cy = ny;
        curIdx = nextIdx;
      }
      continue;
    }

    if (upper === 'S') {
      while (isNum(tokens[i])) {
        const x1 = lastCp ? 2 * cx - lastCp.x : cx;
        const y1 = lastCp ? 2 * cy - lastCp.y : cy;
        const x2 = nextNum() + (rel ? cx : 0);
        const y2 = nextNum() + (rel ? cy : 0);
        const nx = nextNum() + (rel ? cx : 0);
        const ny = nextNum() + (rel ? cy : 0);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, nx * scaleX, ny * scaleY);
        currentLoop.push(
          addCubicSeg(
            b,
            curIdx,
            nextIdx,
            { x: x1 * scaleX, y: y1 * scaleY },
            { x: x2 * scaleX, y: y2 * scaleY },
          ),
        );
        lastCp = { x: x2, y: y2 };
        cx = nx;
        cy = ny;
        curIdx = nextIdx;
      }
      continue;
    }

    if (upper === 'Q') {
      while (isNum(tokens[i])) {
        const qx = nextNum() + (rel ? cx : 0);
        const qy = nextNum() + (rel ? cy : 0);
        const nx = nextNum() + (rel ? cx : 0);
        const ny = nextNum() + (rel ? cy : 0);
        const x1 = cx + (2 / 3) * (qx - cx);
        const y1 = cy + (2 / 3) * (qy - cy);
        const x2 = nx + (2 / 3) * (qx - nx);
        const y2 = ny + (2 / 3) * (qy - ny);
        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }
        const nextIdx = addVertex(b, nx * scaleX, ny * scaleY);
        currentLoop.push(
          addCubicSeg(
            b,
            curIdx,
            nextIdx,
            { x: x1 * scaleX, y: y1 * scaleY },
            { x: x2 * scaleX, y: y2 * scaleY },
          ),
        );
        lastCp = { x: qx, y: qy };
        cx = nx;
        cy = ny;
        curIdx = nextIdx;
      }
      continue;
    }

    if (upper === 'A') {
      while (isNum(tokens[i])) {
        const rx = Math.abs(nextNum());
        const ry = Math.abs(nextNum());
        const rot = nextNum();
        const largeArc = nextNum();
        const sweep = nextNum();
        const nx = nextNum() + (rel ? cx : 0);
        const ny = nextNum() + (rel ? cy : 0);

        if (curIdx === -1) {
          startIdx = addVertex(b, cx * scaleX, cy * scaleY);
          curIdx = startIdx;
        }

        const cubics = arcToCubicBeziers(cx, cy, nx, ny, rx, ry, rot, largeArc !== 0, sweep !== 0);
        for (const c of cubics) {
          const nextIdx = addVertex(b, c.x * scaleX, c.y * scaleY);
          currentLoop.push(
            addCubicSeg(
              b,
              curIdx,
              nextIdx,
              { x: c.x1 * scaleX, y: c.y1 * scaleY },
              { x: c.x2 * scaleX, y: c.y2 * scaleY },
            ),
          );
          curIdx = nextIdx;
        }
        cx = nx;
        cy = ny;
        lastCp = null;
      }
      continue;
    }

    // Fallback for unsupported commands (e.g. T): advance numbers safely
    while (isNum(tokens[i])) {
      i++;
    }
  }
}

function arcToCubicBeziers(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
): Array<{ x1: number; y1: number; x2: number; y2: number; x: number; y: number }> {
  if ((x1 === x2 && y1 === y2) || rxIn === 0 || ryIn === 0) {
    return [{ x1, y1, x2, y2, x: x2, y: y2 }];
  }

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rx = rxIn;
  let ry = ryIn;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(den === 0 ? 0 : num / den);

  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ratio = len === 0 ? 1 : Math.max(-1, Math.min(1, dot / len));
    return sign * Math.acos(ratio);
  };

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const alpha = (4 / 3) * Math.tan(delta / 4);

  const out: Array<{ x1: number; y1: number; x2: number; y2: number; x: number; y: number }> = [];
  for (let s = 0; s < segments; s++) {
    const t1 = theta1 + s * delta;
    const t2 = t1 + delta;
    const cos1 = Math.cos(t1);
    const sin1 = Math.sin(t1);
    const cos2 = Math.cos(t2);
    const sin2 = Math.sin(t2);

    const p1x = cos1 - alpha * sin1;
    const p1y = sin1 + alpha * cos1;
    const p2x = cos2 + alpha * sin2;
    const p2y = sin2 - alpha * cos2;

    const mapPt = (px: number, py: number) => ({
      x: cx + cosPhi * rx * px - sinPhi * ry * py,
      y: cy + sinPhi * rx * px + cosPhi * ry * py,
    });

    const c1 = mapPt(p1x, p1y);
    const c2 = mapPt(p2x, p2y);
    const end = s === segments - 1 ? { x: x2, y: y2 } : mapPt(cos2, sin2);
    out.push({ x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y });
  }
  return out;
}

/**
 * Encodes VectorBuilder into Figma's binary vectorNetworkBlob format.
 */
export function encodeVectorNetworkBlob(b: VectorBuilder): Uint8Array {
  let byteLen = 12 + b.vertices.length * 12 + b.segments.length * 28;
  for (const loop of b.loops) {
    byteLen += 12 + 4 + loop.length * 4;
  }

  const buf = new Uint8Array(byteLen);
  const view = new DataView(buf.buffer);
  let off = 0;

  view.setUint32(off, b.vertices.length, true);
  off += 4;
  view.setUint32(off, b.segments.length, true);
  off += 4;
  view.setUint32(off, b.loops.length, true);
  off += 4;

  for (const v of b.vertices) {
    view.setUint32(off, 0, true); // styleID
    view.setFloat32(off + 4, v.x, true);
    view.setFloat32(off + 8, v.y, true);
    off += 12;
  }

  for (const s of b.segments) {
    view.setUint32(off, 0, true); // styleID
    view.setUint32(off + 4, s.start, true);
    view.setFloat32(off + 8, s.dxStart, true);
    view.setFloat32(off + 12, s.dyStart, true);
    view.setUint32(off + 16, s.end, true);
    view.setFloat32(off + 20, s.dxEnd, true);
    view.setFloat32(off + 24, s.dyEnd, true);
    off += 28;
  }

  for (const loop of b.loops) {
    view.setUint32(off, 0, true); // styleID
    view.setUint32(off + 4, 1, true); // windingRule = NONZERO
    view.setUint32(off + 8, 1, true); // loopCount = 1
    view.setUint32(off + 12, loop.length, true);
    off += 16;
    for (const segIdx of loop) {
      view.setUint32(off, segIdx, true);
      off += 4;
    }
  }

  return buf;
}

export function svgPathToVectorNetworkBlob(d: string, width: number, height: number): Uint8Array | null {
  const b = createBuilder();
  parseSvgPathToBuilder(d, b, 1, 1, true);
  if (b.vertices.length === 0 || b.segments.length === 0) return null;

  // Normalize vertices to [0..width, 0..height] if needed (keep raw if already bounded)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of b.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX > 0 && spanY > 0 && (minX !== 0 || minY !== 0)) {
    const sx = width / spanX;
    const sy = height / spanY;
    for (const v of b.vertices) {
      v.x = (v.x - minX) * sx;
      v.y = (v.y - minY) * sy;
    }
    for (const s of b.segments) {
      s.dxStart *= sx;
      s.dyStart *= sy;
      s.dxEnd *= sx;
      s.dyEnd *= sy;
    }
  }

  return encodeVectorNetworkBlob(b);
}

export interface VectorNetworkResult {
  blob: Uint8Array;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export function lucideToVectorNetworkBlob(
  iconData: LucideIconData,
  width: number,
  height: number,
): VectorNetworkResult | null {
  const b = createBuilder();
  const sx = width / 24;
  const sy = height / 24;

  const num = (attrs: Record<string, string | number>, key: string, def = 0) => {
    const val = attrs[key];
    const parsed = typeof val === 'number' ? val : parseFloat(String(val ?? def));
    return Number.isFinite(parsed) ? parsed : def;
  };

  for (const [tag, attrs] of iconData) {
    if (tag === 'path' && typeof attrs.d === 'string') {
      parseSvgPathToBuilder(attrs.d, b, sx, sy, false);
    } else if (tag === 'line') {
      const i1 = addVertex(b, num(attrs, 'x1') * sx, num(attrs, 'y1') * sy);
      const i2 = addVertex(b, num(attrs, 'x2') * sx, num(attrs, 'y2') * sy);
      addLineSeg(b, i1, i2);
    } else if (tag === 'circle') {
      const cx = num(attrs, 'cx');
      const cy = num(attrs, 'cy');
      const r = num(attrs, 'r');
      const d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
      parseSvgPathToBuilder(d, b, sx, sy, false);
    } else if (tag === 'ellipse') {
      const cx = num(attrs, 'cx');
      const cy = num(attrs, 'cy');
      const rx = num(attrs, 'rx');
      const ry = num(attrs, 'ry');
      const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
      parseSvgPathToBuilder(d, b, sx, sy, false);
    } else if (tag === 'rect') {
      const x = num(attrs, 'x');
      const y = num(attrs, 'y');
      const w = num(attrs, 'width');
      const h = num(attrs, 'height');
      const rx = Math.min(num(attrs, 'rx', num(attrs, 'ry', 0)), w / 2, h / 2);
      const d =
        rx > 0
          ? `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${rx} 0 0 1 ${x + w} ${y + rx} V ${y + h - rx} A ${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${rx} 0 0 1 ${x} ${y + h - rx} V ${y + rx} A ${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`
          : `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
      parseSvgPathToBuilder(d, b, sx, sy, false);
    } else if ((tag === 'polyline' || tag === 'polygon') && typeof attrs.points === 'string') {
      const nums = attrs.points.match(/[-+]?(?:\d*\.\d+|\d+\.?)/g)?.map(Number) ?? [];
      if (nums.length >= 4) {
        const parts: string[] = [`M ${nums[0]} ${nums[1]}`];
        for (let k = 2; k + 1 < nums.length; k += 2) {
          parts.push(`L ${nums[k]} ${nums[k + 1]}`);
        }
        if (tag === 'polygon') parts.push('Z');
        parseSvgPathToBuilder(parts.join(' '), b, sx, sy, false);
      }
    }
  }

  if (b.vertices.length === 0 || b.segments.length === 0) return null;

  // Shift vertices so bounding box starts at (0, 0) — Figma expects VECTOR geometry
  // to span [0..size.x, 0..size.y] without hidden leading offsets.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of b.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  for (const v of b.vertices) {
    v.x -= minX;
    v.y -= minY;
  }

  return {
    blob: encodeVectorNetworkBlob(b),
    offsetX: minX,
    offsetY: minY,
    width: spanX,
    height: spanY,
  };
}

/**
 * Decodes Figma's binary vectorNetworkBlob back into an SVG path `d` string.
 */
export function vectorNetworkBlobToSvgPath(bytes: Uint8Array): string {
  if (bytes.length < 12) return '';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(0, true);
  const segmentCount = view.getUint32(4, true);

  const verticesOffset = 12;
  const segmentsOffset = verticesOffset + vertexCount * 12;
  if (bytes.length < segmentsOffset + segmentCount * 28) return '';

  const vertices: Vec2[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const off = verticesOffset + i * 12;
    vertices.push({
      x: view.getFloat32(off + 4, true),
      y: view.getFloat32(off + 8, true),
    });
  }

  const fmt = (n: number) => Number(n.toFixed(3));
  const parts: string[] = [];
  let prevEnd = -1;

  for (let i = 0; i < segmentCount; i++) {
    const off = segmentsOffset + i * 28;
    const start = view.getUint32(off + 4, true);
    const dxStart = view.getFloat32(off + 8, true);
    const dyStart = view.getFloat32(off + 12, true);
    const end = view.getUint32(off + 16, true);
    const dxEnd = view.getFloat32(off + 20, true);
    const dyEnd = view.getFloat32(off + 24, true);

    const p0 = vertices[start];
    const p1 = vertices[end];
    if (!p0 || !p1) continue;

    if (start !== prevEnd) {
      parts.push(`M ${fmt(p0.x)} ${fmt(p0.y)}`);
    }

    const isLine =
      Math.abs(dxStart) < 1e-4 &&
      Math.abs(dyStart) < 1e-4 &&
      Math.abs(dxEnd) < 1e-4 &&
      Math.abs(dyEnd) < 1e-4;

    if (isLine) {
      parts.push(`L ${fmt(p1.x)} ${fmt(p1.y)}`);
    } else {
      parts.push(
        `C ${fmt(p0.x + dxStart)} ${fmt(p0.y + dyStart)} ${fmt(p1.x + dxEnd)} ${fmt(p1.y + dyEnd)} ${fmt(p1.x)} ${fmt(p1.y)}`,
      );
    }
    prevEnd = end;
  }

  return parts.join(' ');
}


/**
 * Decode Figma's binary `commandsBlob` (used in `fillGeometry` / `strokeGeometry`)
 * into an SVG path `d` string.
 * Opcodes: 0 = Z, 1 = M (2 f32), 2 = L (2 f32), 3 = Q (4 f32), 4 = C (6 f32).
 */
export function commandsBlobToSvgPath(bytes: Uint8Array): string {
  if (!bytes || bytes.byteLength === 0) return '';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const parts: string[] = [];
  const f = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

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
        parts.push(`M ${f(view.getFloat32(off, true))} ${f(view.getFloat32(off + 4, true))}`);
        off += 8;
        break;
      case 2:
        if (off + 8 > bytes.byteLength) return parts.join(' ');
        parts.push(`L ${f(view.getFloat32(off, true))} ${f(view.getFloat32(off + 4, true))}`);
        off += 8;
        break;
      case 3:
        if (off + 16 > bytes.byteLength) return parts.join(' ');
        parts.push(
          `Q ${f(view.getFloat32(off, true))} ${f(view.getFloat32(off + 4, true))} ${f(view.getFloat32(off + 8, true))} ${f(view.getFloat32(off + 12, true))}`,
        );
        off += 16;
        break;
      case 4:
        if (off + 24 > bytes.byteLength) return parts.join(' ');
        parts.push(
          `C ${f(view.getFloat32(off, true))} ${f(view.getFloat32(off + 4, true))} ${f(view.getFloat32(off + 8, true))} ${f(view.getFloat32(off + 12, true))} ${f(view.getFloat32(off + 16, true))} ${f(view.getFloat32(off + 20, true))}`,
        );
        off += 24;
        break;
      default:
        return parts.join(' ');
    }
  }
  return parts.join(' ');
}
