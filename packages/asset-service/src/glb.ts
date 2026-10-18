import { createHash } from "node:crypto";

/** Minimal binary glTF 2.0 reader/writer: enough to measure, validate and re-root a model. */

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export type Gltf = {
  asset?: { version?: string };
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; name?: string }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[] }[];
  bufferViews?: { byteLength: number }[];
  images?: { uri?: string; bufferView?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  [key: string]: unknown;
};

export class GlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlbError";
  }
}

export function parseGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array | null } {
  if (bytes.byteLength < 20) throw new GlbError("File is too small to be a GLB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new GlbError("Not a GLB file (bad magic).");
  if (view.getUint32(4, true) !== 2) throw new GlbError("Only glTF 2.0 is supported.");
  if (view.getUint32(8, true) !== bytes.byteLength) throw new GlbError("GLB length header does not match file size.");
  let offset = 12;
  let json: Gltf | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) throw new GlbError("GLB chunk runs past the end of the file.");
    if (type === CHUNK_JSON && !json) {
      try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as Gltf; }
      catch { throw new GlbError("GLB JSON chunk is not valid JSON."); }
    } else if (type === CHUNK_BIN && !bin) {
      bin = bytes.subarray(start, start + length);
    }
    offset = start + length;
  }
  if (!json) throw new GlbError("GLB has no JSON chunk.");
  return { json, bin };
}

export function writeGlb(json: Gltf, bin: Uint8Array | null): Uint8Array {
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = pad(jsonBytes.length);
  const binLen = bin ? bin.length : 0;
  const binPad = pad(binLen);
  const total = 12 + 8 + jsonBytes.length + jsonPad + (bin ? 8 + binLen + binPad : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let o = 12;
  view.setUint32(o, jsonBytes.length + jsonPad, true);
  view.setUint32(o + 4, CHUNK_JSON, true);
  out.set(jsonBytes, o + 8);
  out.fill(0x20, o + 8 + jsonBytes.length, o + 8 + jsonBytes.length + jsonPad);
  o += 8 + jsonBytes.length + jsonPad;
  if (bin) {
    view.setUint32(o, binLen + binPad, true);
    view.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

// --- column-major 4x4 helpers ------------------------------------------------
type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}

function nodeMatrix(node: NonNullable<Gltf["nodes"]>[number]): Mat {
  if (node.matrix?.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export type GlbInspection = {
  /** World-space axis-aligned bounds of all triangle meshes, glTF axes (X right, Y up, Z front). */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  size: [number, number, number];
  triangleCount: number;
  textureBytes: number;
  imageCount: number;
  meshInstanceCount: number;
  /** Non-embedded buffer/image URIs: the file would not load on its own. */
  externalResources: string[];
  nonTriangleGeometry: boolean;
  requiredExtensions: string[];
  fileBytes: number;
  contentHash: string;
};

export function inspectGlb(bytes: Uint8Array): GlbInspection {
  const { json } = parseGlb(bytes);
  const nodes = json.nodes ?? [];
  const accessors = json.accessors ?? [];
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0, instances = 0, nonTriangle = false;

  const visit = (index: number, parent: Mat, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) throw new GlbError("Node graph is invalid or too deep.");
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) throw new GlbError("Node references a missing mesh.");
      instances++;
      for (const prim of mesh.primitives) {
        const mode = prim.mode ?? 4;
        if (mode < 4) { nonTriangle = true; continue; }
        const position = accessors[prim.attributes.POSITION];
        if (!position?.min || !position.max) throw new GlbError("Mesh POSITION accessor lacks min/max bounds.");
        const count = prim.indices !== undefined ? accessors[prim.indices]?.count ?? 0 : position.count;
        triangles += mode === 4 ? Math.floor(count / 3) : Math.max(count - 2, 0);
        for (const cx of [position.min[0], position.max[0]]) for (const cy of [position.min[1], position.max[1]]) for (const cz of [position.min[2], position.max[2]]) {
          for (let axis = 0; axis < 3; axis++) {
            const v = world[axis] * cx + world[4 + axis] * cy + world[8 + axis] * cz + world[12 + axis];
            if (v < min[axis]) min[axis] = v;
            if (v > max[axis]) max[axis] = v;
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, IDENTITY, 0);

  const external: string[] = [];
  for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith("data:")) external.push(b.uri);
  let textureBytes = 0;
  for (const image of json.images ?? []) {
    if (image.uri) {
      if (image.uri.startsWith("data:")) textureBytes += Math.floor((image.uri.length * 3) / 4);
      else external.push(image.uri);
    } else if (image.bufferView !== undefined) {
      textureBytes += json.bufferViews?.[image.bufferView]?.byteLength ?? 0;
    }
  }
  const hasBounds = Number.isFinite(min[0]);
  const size: [number, number, number] = hasBounds ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : [0, 0, 0];
  return {
    boundsMin: hasBounds ? min : [0, 0, 0],
    boundsMax: hasBounds ? max : [0, 0, 0],
    size,
    triangleCount: triangles,
    textureBytes,
    imageCount: json.images?.length ?? 0,
    meshInstanceCount: instances,
    externalResources: external,
    nonTriangleGeometry: nonTriangle,
    requiredExtensions: json.extensionsRequired ?? [],
    fileBytes: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Re-roots the model under one wrapper node that uniformly scales it to fit the
 * target envelope (same rule as the renderer) and puts its origin at the
 * base-center (x/z centered, lowest point on y = 0). Geometry buffers are untouched.
 */
export function normalizeGlb(bytes: Uint8Array, targetDimensionsM: [number, number, number]): Uint8Array {
  const inspection = inspectGlb(bytes);
  const { size, boundsMin, boundsMax } = inspection;
  if (!size.every((n) => Number.isFinite(n) && n > 1e-6)) throw new GlbError("Model has no measurable volume.");
  const scale = Math.min(...targetDimensionsM.map((t, i) => t / size[i]));
  if (!(scale > 0 && Number.isFinite(scale))) throw new GlbError("Target dimensions must be positive.");
  const cx = (boundsMin[0] + boundsMax[0]) / 2, cz = (boundsMin[2] + boundsMax[2]) / 2;
  const { json, bin } = parseGlb(bytes);
  const nodes = json.nodes ?? (json.nodes = []);
  const sceneIndex = json.scene ?? 0;
  const scenes = json.scenes ?? (json.scenes = [{ nodes: [] }]);
  const scene = scenes[sceneIndex] ?? (scenes[sceneIndex] = { nodes: [] });
  nodes.push({
    name: "house_normalized_root",
    matrix: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, -cx * scale, -boundsMin[1] * scale, -cz * scale, 1],
    children: scene.nodes ?? [],
  });
  scene.nodes = [nodes.length - 1];
  return writeGlb(json, bin);
}
