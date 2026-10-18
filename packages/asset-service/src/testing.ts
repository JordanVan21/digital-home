import { writeGlb, type Gltf } from "./glb";

/** Test/dev helper: a self-contained GLB made of one box mesh, optionally under a transformed node. */
export function buildBoxGlb(opts: {
  size: [number, number, number];
  /** Box center in mesh space. */
  center?: [number, number, number];
  nodeScale?: number;
  nodeTranslation?: [number, number, number];
  /** Extra json merged into the top level (e.g. extensionsRequired, images). */
  extra?: Partial<Gltf>;
}): Uint8Array {
  const [w, h, d] = opts.size.map((n) => n / 2);
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];
  const corners: number[] = [];
  for (const x of [-w, w]) for (const y of [-h, h]) for (const z of [-d, d]) corners.push(x + cx, y + cy, z + cz);
  const indices = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  const pos = new Float32Array(corners);
  const idx = new Uint16Array(indices);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const min = [cx - w, cy - h, cz - d], max = [cx + w, cy + h, cz + d];
  const json: Gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...(opts.nodeScale ? { scale: [opts.nodeScale, opts.nodeScale, opts.nodeScale] } : {}), ...(opts.nodeTranslation ? { translation: opts.nodeTranslation } : {}) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min, max } as never,
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" } as never,
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }] as never,
    buffers: [{ byteLength: bin.byteLength }],
    ...opts.extra,
  };
  return writeGlb(json, bin);
}
