import type { AssetSpec, SceneObject, Tilt } from "@house/contracts";
import profiles from "./colliderProfiles.json";
import { overlaps, rectangle, scaledDimensions, yawOf } from "./geometry";

type Block = number[][];
type Profile = { contentHash: string; boxes: Block[] };
const baked: Record<string, Profile> = profiles;
/** Ignore at most 0.1 mm penetration; no extra whole-object clearance halo. */
export const COLLISION_TOLERANCE_M = 0.0001;
const full: Block[] = [
  [
    [0, 0, 0],
    [1, 1, 1],
  ],
];
const tilted = new WeakMap<Block[], Map<string, Block[]>>();
/**
 * Unit-box blocks turned with the model: +90° about X maps (x, y, z) to
 * (x, 1 - z, y), then +90° about Z maps it to (1 - y, x, z). Cached per profile
 * and tilt so downstream caches keyed by identity stay warm.
 */
function tiltBlocks(boxes: Block[], tilt: Tilt): Block[] {
  const key = `${tilt.x % 4},${tilt.z % 4}`;
  if (key === "0,0") return boxes;
  let byTilt = tilted.get(boxes);
  if (!byTilt) tilted.set(boxes, (byTilt = new Map()));
  const cached = byTilt.get(key);
  if (cached) return cached;
  const turn = (b: Block[], axis: "x" | "z") =>
    b.map(([min, max]) =>
      axis === "x"
        ? [
            [min[0], 1 - max[2], min[1]],
            [max[0], 1 - min[2], max[1]],
          ]
        : [
            [1 - max[1], min[0], min[2]],
            [1 - min[1], max[0], max[2]],
          ],
    );
  let result = boxes;
  for (let i = 0; i < tilt.x % 4; i++) result = turn(result, "x");
  for (let i = 0; i < tilt.z % 4; i++) result = turn(result, "z");
  byTilt.set(key, result);
  return result;
}
export function colliderBlocks(
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
) {
  const profile = o.assetId ? baked[o.assetId] : undefined;
  const boxes =
    profile && profile.contentHash === assets[o.assetId!]?.contentHash
      ? profile.boxes
      : full;
  return o.tilt ? tiltBlocks(boxes, o.tilt) : boxes;
}
function worldBlocks(o: SceneObject) {
  const size = scaledDimensions(o);
  const yaw = yawOf(o.transform.rotation),
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  return ([min, max]: Block, tolerance = COLLISION_TOLERANCE_M) => {
    const x = ((min[0] + max[0]) / 2 - 0.5) * size[0];
    const z = ((min[2] + max[2]) / 2 - 0.5) * size[2];
    const width = Math.max(0, (max[0] - min[0]) * size[0] - tolerance);
    const depth = Math.max(0, (max[2] - min[2]) * size[2] - tolerance);
    const polygon = rectangle(
      [
        o.transform.position[0] + c * x + s * z,
        o.transform.position[2] - s * x + c * z,
      ],
      width,
      depth,
      yaw,
    );
    return {
      minX: Math.min(...polygon.map((p) => p[0])),
      maxX: Math.max(...polygon.map((p) => p[0])),
      minZ: Math.min(...polygon.map((p) => p[1])),
      maxZ: Math.max(...polygon.map((p) => p[1])),
      bottom: o.transform.position[1] + min[1] * size[1],
      top: o.transform.position[1] + max[1] * size[1],
      polygon,
    };
  };
}
type Node = {
  bounds: Block;
  count: number;
  indices?: number[];
  children?: [Node, Node];
};
const trees = new WeakMap<Block[], Node>();
function tree(boxes: Block[]): Node {
  const cached = trees.get(boxes);
  if (cached) return cached;
  const build = (indices: number[]): Node => {
    const min = [0, 1, 2].map((axis) =>
      Math.min(...indices.map((i) => boxes[i][0][axis])),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...indices.map((i) => boxes[i][1][axis])),
    );
    const bounds = [min, max];
    if (indices.length <= 4) return { bounds, count: indices.length, indices };
    const spans = max.map((n, i) => n - min[i]);
    const axis = spans.indexOf(Math.max(...spans));
    indices.sort(
      (a, b) =>
        boxes[a][0][axis] +
        boxes[a][1][axis] -
        boxes[b][0][axis] -
        boxes[b][1][axis],
    );
    const mid = Math.floor(indices.length / 2);
    return {
      bounds,
      count: indices.length,
      children: [build(indices.slice(0, mid)), build(indices.slice(mid))],
    };
  };
  const root = build(boxes.map((_, i) => i));
  trees.set(boxes, root);
  return root;
}
/** Optional counters for deterministic profiling; timings are measured separately. */
export type CollisionWork = { nodePairs: number; boxPairs: number };
type WorldBlock = ReturnType<ReturnType<typeof worldBlocks>>;
const boundsOverlap = (a: WorldBlock, b: WorldBlock) =>
  Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) >
    COLLISION_TOLERANCE_M &&
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ;
/** Cached local BVHs preserve every gap in the compound. Only reached leaves
 * require transformed boxes and the existing yaw-aware SAT test. */
export function objectsCollide(
  a: SceneObject,
  b: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
  work?: CollisionWork,
): boolean {
  const aa = colliderBlocks(a, assets),
    bb = colliderBlocks(b, assets);
  const makeA = worldBlocks(a),
    makeB = worldBlocks(b);
  const nodesA = new Map<Node, WorldBlock>(),
    nodesB = new Map<Node, WorldBlock>();
  const leavesA = new Map<number, WorldBlock>(),
    leavesB = new Map<number, WorldBlock>();
  const nodeBox = (
    node: Node,
    map: Map<Node, WorldBlock>,
    make: typeof makeA,
  ) => {
    let box = map.get(node);
    if (!box) {
      box = make(node.bounds, 0);
      map.set(node, box);
    }
    return box;
  };
  const leafBox = (
    index: number,
    map: Map<number, WorldBlock>,
    boxes: Block[],
    make: typeof makeA,
  ) => {
    let box = map.get(index);
    if (!box) {
      box = make(boxes[index]);
      map.set(index, box);
    }
    return box;
  };
  const visit = (x: Node, y: Node): boolean => {
    if (work) work.nodePairs++;
    if (!boundsOverlap(nodeBox(x, nodesA, makeA), nodeBox(y, nodesB, makeB)))
      return false;
    if (x.indices && y.indices) {
      for (const i of x.indices)
        for (const j of y.indices) {
          if (work) work.boxPairs++;
          const p = leafBox(i, leavesA, aa, makeA),
            q = leafBox(j, leavesB, bb, makeB);
          if (boundsOverlap(p, q) && overlaps(p.polygon, q.polygon))
            return true;
        }
      return false;
    }
    if (x.children && (!y.children || x.count >= y.count))
      return x.children.some((child) => visit(child, y));
    return y.children!.some((child) => visit(x, child));
  };
  return visit(tree(aa), tree(bb));
}
