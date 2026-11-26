import {
  compileSchema,
  decodeBinarySchema,
  encodeBinarySchema,
  parseSchema,
  type Schema,
} from 'kiwi-schema';
import { deflateSync, inflateSync, unzipSync, unzlibSync, zipSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

export interface FigGuid {
  sessionID: number;
  localID: number;
}

export interface FigParentIndex {
  guid: FigGuid;
  position: string;
}

export interface FigColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigVector {
  x: number;
  y: number;
}

export interface FigMatrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface FigColorStop {
  color: FigColor;
  position: number;
}

export interface FigPaint {
  type?: string;
  color?: FigColor;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  stops?: FigColorStop[];
  transform?: FigMatrix;
}

export interface FigEffect {
  type?: string;
  color?: FigColor;
  offset?: FigVector;
  radius?: number;
  spread?: number;
  visible?: boolean;
}

export interface FigFontName {
  family?: string;
  style?: string;
  postscript?: string;
}

export interface FigTextData {
  characters?: string;
}

export interface FigNumberWithUnit {
  value?: number;
  units?: string;
}

export interface FigVectorData {
  vectorNetworkBlob?: number;
  normalizedSize?: FigVector;
}

export interface FigBlob {
  bytes: Uint8Array;
}

export interface FigNodeChange {
  guid: FigGuid;
  phase?: string;
  parentIndex?: FigParentIndex;
  type?: string;
  name?: string;
  visible?: boolean;
  opacity?: number;
  size?: FigVector;
  transform?: FigMatrix;
  cornerRadius?: number;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  fillPaints?: FigPaint[];
  strokePaints?: FigPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: number[];
  effects?: FigEffect[];
  clipsContent?: boolean;
  stackMode?: string;
  stackSpacing?: number;
  stackPadding?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  fontSize?: number;
  fontName?: FigFontName;
  textData?: FigTextData;
  textAlignHorizontal?: string;
  lineHeight?: FigNumberWithUnit;
  letterSpacing?: FigNumberWithUnit;
  count?: number;
  vectorData?: FigVectorData;
  stackPositioning?: string;
  [key: string]: unknown;
}

export interface FigKiwiDocument {
  version: number;
  schema: Schema;
  message: {
    type?: string;
    nodeChanges?: FigNodeChange[];
    [key: string]: unknown;
  };
  images: Record<string, Uint8Array>;
}

const FIG_KIWI_MAGIC = 'fig-kiwi';

/**
 * Minimal Kiwi schema compatible with Figma's canvas.fig structure.
 */
export const FIGMA_KIWI_SCHEMA: Schema = parseSchema(`
  enum MessageType {
    JOIN_CHAN = 0;
    NODE_CHANGES = 1;
  }

  enum NodePhase {
    CREATED = 0;
    REMOVED = 1;
  }

  enum NodeType {
    NONE = 0;
    DOCUMENT = 1;
    CANVAS = 2;
    GROUP = 3;
    FRAME = 4;
    BOOLEAN_OPERATION = 5;
    VECTOR = 6;
    STAR = 7;
    LINE = 8;
    ELLIPSE = 9;
    RECTANGLE = 10;
    REGULAR_POLYGON = 11;
    ROUNDED_RECTANGLE = 12;
    TEXT = 13;
    SLICE = 14;
    SYMBOL = 15;
    INSTANCE = 16;
    COMPONENT = 17;
  }

  enum PaintType {
    SOLID = 0;
    GRADIENT_LINEAR = 1;
    GRADIENT_RADIAL = 2;
    GRADIENT_ANGULAR = 3;
    IMAGE = 4;
  }

  enum EffectType {
    INNER_SHADOW = 0;
    DROP_SHADOW = 1;
    FOREGROUND_BLUR = 2;
    BACKGROUND_BLUR = 3;
  }

  enum StackMode {
    NONE = 0;
    HORIZONTAL = 1;
    VERTICAL = 2;
  }

  enum StackAlign {
    MIN = 0;
    CENTER = 1;
    MAX = 2;
    SPACE_EVENLY = 3;
    SPACE_BETWEEN = 4;
    BASELINE = 5;
  }

  enum StrokeAlign {
    CENTER = 0;
    INSIDE = 1;
    OUTSIDE = 2;
  }

  enum StrokeCap {
    NONE = 0;
    ROUND = 1;
    SQUARE = 2;
  }

  enum StrokeJoin {
    MITER = 0;
    BEVEL = 1;
    ROUND = 2;
  }

  enum StackPositioning {
    AUTO = 0;
    ABSOLUTE = 1;
  }

  enum TextAlignHorizontal {
    LEFT = 0;
    CENTER = 1;
    RIGHT = 2;
    JUSTIFIED = 3;
  }

  struct GUID {
    uint sessionID;
    uint localID;
  }

  struct ParentIndex {
    GUID guid;
    string position;
  }

  struct Color {
    float r;
    float g;
    float b;
    float a;
  }

  struct Vector {
    float x;
    float y;
  }

  struct Matrix {
    float m00;
    float m01;
    float m02;
    float m10;
    float m11;
    float m12;
  }

  struct ColorStop {
    Color color;
    float position;
  }

  message Paint {
    PaintType type = 1;
    Color color = 2;
    float opacity = 3;
    bool visible = 4;
    ColorStop[] stops = 5;
    Matrix transform = 6;
  }

  message Effect {
    EffectType type = 1;
    Color color = 2;
    Vector offset = 3;
    float radius = 4;
    float spread = 5;
    bool visible = 6;
  }

  struct FontName {
    string family;
    string style;
    string postscript;
  }

  message TextData {
    string characters = 1;
  }

  struct VectorData {
    uint vectorNetworkBlob;
    Vector normalizedSize;
  }

  message Blob {
    byte[] bytes = 1;
  }

  message NodeChange {
    GUID guid = 1;
    NodePhase phase = 2;
    ParentIndex parentIndex = 3;
    NodeType type = 4;
    string name = 5;
    bool visible = 6;
    float opacity = 7;
    Vector size = 8;
    Matrix transform = 9;
    float cornerRadius = 10;
    Paint[] fillPaints = 11;
    Paint[] strokePaints = 12;
    float strokeWeight = 13;
    StrokeAlign strokeAlign = 14;
    Effect[] effects = 15;
    bool clipsContent = 16;
    StackMode stackMode = 17;
    float stackSpacing = 18;
    float stackHorizontalPadding = 19;
    float stackVerticalPadding = 20;
    StackAlign stackPrimaryAlignItems = 21;
    StackAlign stackCounterAlignItems = 22;
    float fontSize = 23;
    FontName fontName = 24;
    TextData textData = 25;
    TextAlignHorizontal textAlignHorizontal = 26;
    uint count = 27;
    VectorData vectorData = 28;
    StrokeCap strokeCap = 29;
    StrokeJoin strokeJoin = 30;
    StackPositioning stackPositioning = 31;
    float stackPaddingRight = 32;
    float stackPaddingBottom = 33;
  }

  message Message {
    MessageType type = 1;
    uint sessionID = 2;
    uint ackID = 3;
    NodeChange[] nodeChanges = 4;
    Blob[] blobs = 5;
  }
`);

function isZipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isZstdHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
}

function isZlibHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x5e || bytes[1] === 0x9c || bytes[1] === 0xda);
}

function decompressChunk(payload: Uint8Array): Uint8Array {
  if (isZstdHeader(payload)) {
    return zstdDecompress(payload);
  }
  if (isZlibHeader(payload)) {
    return unzlibSync(payload);
  }
  return inflateSync(payload);
}

export function parseFigFile(input: ArrayBuffer | Uint8Array): FigKiwiDocument {
  let rawBytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const images: Record<string, Uint8Array> = {};

  if (isZipHeader(rawBytes)) {
    const entries = unzipSync(rawBytes);
    const canvasEntry = entries['canvas.fig'] ?? Object.entries(entries).find(([k]) => k.endsWith('.fig'))?.[1];
    if (!canvasEntry) {
      throw new Error('Invalid .fig archive: canvas.fig not found');
    }
    for (const [key, data] of Object.entries(entries)) {
      if (key.startsWith('images/') && data.length > 0) {
        images[key.slice('images/'.length)] = data;
      }
    }
    rawBytes = canvasEntry;
  }

  if (rawBytes.length < 12) {
    throw new Error('Invalid .fig file: header too short');
  }

  const magic = String.fromCharCode(...rawBytes.slice(0, 8));
  if (magic !== FIG_KIWI_MAGIC) {
    throw new Error(`Invalid .fig file: expected "${FIG_KIWI_MAGIC}" header, got "${magic}"`);
  }

  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const version = view.getUint32(8, true);

  let offset = 12;
  const chunks: Uint8Array[] = [];
  while (offset + 4 <= rawBytes.length) {
    const len = view.getUint32(offset, true);
    offset += 4;
    if (offset + len > rawBytes.length) {
      throw new Error('Invalid .fig file: truncated chunk');
    }
    chunks.push(rawBytes.slice(offset, offset + len));
    offset += len;
  }

  if (chunks.length < 2) {
    throw new Error('Invalid .fig file: expected at least 2 chunks (schema + data)');
  }

  const schemaBytes = decompressChunk(chunks[0]);
  const dataBytes = decompressChunk(chunks[1]);

  const schema = decodeBinarySchema(schemaBytes);
  const compiled = compileSchema(schema) as {
    decodeMessage: (buf: Uint8Array) => FigKiwiDocument['message'];
  };
  const message = compiled.decodeMessage(dataBytes);

  return { version, schema, message, images };
}

export function buildFigFile(
  nodeChanges: FigNodeChange[],
  title = 'OpenPenViewer',
  blobs: FigBlob[] = [],
): Uint8Array {
  const schemaBytes = encodeBinarySchema(FIGMA_KIWI_SCHEMA);
  const compiled = compileSchema(FIGMA_KIWI_SCHEMA) as {
    encodeMessage: (msg: Record<string, unknown>) => Uint8Array;
  };
  const dataBytes = compiled.encodeMessage({
    type: 'JOIN_CHAN',
    sessionID: 1,
    ackID: 0,
    nodeChanges,
    ...(blobs.length > 0 ? { blobs } : {}),
  });

  const compressedSchema = deflateSync(schemaBytes);
  const compressedData = deflateSync(dataBytes);

  const canvasBytes = new Uint8Array(12 + 4 + compressedSchema.length + 4 + compressedData.length);
  for (let i = 0; i < FIG_KIWI_MAGIC.length; i++) {
    canvasBytes[i] = FIG_KIWI_MAGIC.charCodeAt(i);
  }
  const view = new DataView(canvasBytes.buffer);
  view.setUint32(8, 15, true);

  let offset = 12;
  view.setUint32(offset, compressedSchema.length, true);
  offset += 4;
  canvasBytes.set(compressedSchema, offset);
  offset += compressedSchema.length;

  view.setUint32(offset, compressedData.length, true);
  offset += 4;
  canvasBytes.set(compressedData, offset);

  const metaJson = new TextEncoder().encode(
    JSON.stringify({
      client_meta: { background_color: { r: 0.96, g: 0.96, b: 0.96, a: 1 } },
      file_name: title,
      exported_at: new Date().toISOString(),
    }),
  );

  return zipSync({
    'canvas.fig': canvasBytes,
    'meta.json': metaJson,
  });
}
