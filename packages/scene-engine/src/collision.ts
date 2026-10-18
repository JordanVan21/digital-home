import type { AssetSpec, SceneObject, Tilt, Vec3 } from "@house/contracts";
import profiles from "./colliderProfiles.json";
import { boxCorners, scaledDimensions } from "./geometry";
import { rotateVector } from "./rotation";

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
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).map((v) => rotateVector(v, o.transform.rotation));
  return ([min, max]: Block, tolerance = COLLISION_TOLERANCE_M) => {
    const corners = boxCorners(o, min, max);
    const center = corners[0].map(
      (_, i) => corners.reduce((sum, p) => sum + p[i], 0) / 8,
    ) as Vec3;
    const half = size.map((v, i) =>
      Math.max(0, ((max[i] - min[i]) * v - tolerance) / 2),
    ) as Vec3;
    return {
      center,
      half,
      axes,
      minX: Math.min(...corners.map((p) => p[0])),
      maxX: Math.max(...corners.map((p) => p[0])),
      minZ: Math.min(...corners.map((p) => p[2])),
      maxZ: Math.max(...corners.map((p) => p[2])),
      bottom: Math.min(...corners.map((p) => p[1])),
      top: Math.max(...corners.map((p) => p[1])),
    };
  };
}
const dot3 = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
function obbOverlap(a: WorldBlock, b: WorldBlock) {
  const axes = [...a.axes, ...b.axes];
  for (const u of a.axes)
    for (const v of b.axes)
      axes.push([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
  const delta = b.center.map((n, i) => n - a.center[i]) as Vec3;
  for (const axis of axes) {
    const len = Math.hypot(...axis);
    if (len < 1e-9) continue;
    const n = axis.map((v) => v / len) as Vec3;
    const radius = (box: WorldBlock) =>
      box.axes.reduce((s, v, i) => s + Math.abs(dot3(n, v)) * box.half[i], 0);
    if (radius(a) + radius(b) - Math.abs(dot3(delta, n)) <= 1e-7) return false;
  }
  return true;
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
          if (boundsOverlap(p, q) && obbOverlap(p, q)) return true;
        }
      return false;
    }
    if (x.children && (!y.children || x.count >= y.count))
      return x.children.some((child) => visit(child, y));
    return y.children!.some((child) => visit(x, child));
  };
  return visit(tree(aa), tree(bb));
}
/** Contact vertices from reached BVH leaves, including side contact for leaning
 * pieces. No whole-object box or category exemptions enter the support hull. */
export function objectContactPoints(
  a: SceneObject,
  b: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
  distanceM = COLLISION_TOLERANCE_M,
): Vec3[] {
  const aa = colliderBlocks(a, assets),
    bb = colliderBlocks(b, assets),
    makeA = worldBlocks(a),
    makeB = worldBlocks(b);
  const points: Vec3[] = [];
  const near = (p: WorldBlock, q: WorldBlock) =>
    p.minX <= q.maxX + distanceM &&
    p.maxX >= q.minX - distanceM &&
    p.minZ <= q.maxZ + distanceM &&
    p.maxZ >= q.minZ - distanceM &&
    p.bottom <= q.top + distanceM &&
    p.top >= q.bottom - distanceM;
  const collect = (source: SceneObject, block: Block, target: WorldBlock) => {
    const corners = boxCorners(source, ...(block as [number[], number[]]));
    const test = (vertex: Vec3) => {
      const delta = vertex.map((n, i) => n - target.center[i]) as Vec3;
      const local = target.axes.map((axis) => dot3(delta, axis));
      if (
        local.every((n, i) => Math.abs(n) <= target.half[i] + distanceM) &&
        local.some(
          (n, i) => Math.abs(Math.abs(n) - target.half[i]) <= distanceM,
        )
      )
        points.push(vertex);
    };
    corners.forEach(test);
    for (let i = 0; i < 8; i++)
      for (const bit of [1, 2, 4]) {
        const j = i ^ bit;
        if (j <= i) continue;
        const from = corners[i],
          to = corners[j];
        for (let axis = 0; axis < 3; axis++)
          for (const sign of [-1, 1]) {
            const n = target.axes[axis],
              d = to.map((v, k) => v - from[k]) as Vec3,
              den = dot3(d, n);
            if (Math.abs(den) < 1e-10) continue;
            const delta = from.map((v, k) => v - target.center[k]) as Vec3;
            const t = (sign * target.half[axis] - dot3(delta, n)) / den;
            if (t >= 0 && t <= 1)
              test(from.map((v, k) => v + t * d[k]) as Vec3);
          }
      }
  };
  const visit = (x: Node, y: Node) => {
    if (!near(makeA(x.bounds, 0), makeB(y.bounds, 0))) return;
    if (x.indices && y.indices) {
      for (const i of x.indices)
        for (const j of y.indices) {
          const p = makeA(aa[i], 0),
            q = makeB(bb[j], 0);
          if (!near(p, q)) continue;
          collect(a, aa[i], q);
          collect(b, bb[j], p);
        }
      return;
    }
    if (x.children && (!y.children || x.count >= y.count))
      x.children.forEach((child) => visit(child, y));
    else y.children!.forEach((child) => visit(x, child));
  };
  visit(tree(aa), tree(bb));
  return points;
}

const centres = new WeakMap<Block[], Vec3>();
/** Uniform occupied-volume centre; unlike the outer box this accounts for empty
 * space around an arc lamp or the branches of a plant. */
export function objectCentre(
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
): Vec3 {
  const boxes = colliderBlocks(o, assets);
  let centre = centres.get(boxes);
  if (!centre) {
    let total = 0;
    const sum = [0, 0, 0];
    for (const [lo, hi] of boxes) {
      const v = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
      total += v;
      for (let i = 0; i < 3; i++) sum[i] += (v * (lo[i] + hi[i])) / 2;
    }
    centre = sum.map((n) => n / total) as Vec3;
    centres.set(boxes, centre);
  }
  const size = scaledDimensions(o);
  const offset = rotateVector(
    centre.map((n, i) => (n - (i === 1 ? 0 : 0.5)) * size[i]) as Vec3,
    o.transform.rotation,
  );
  return offset.map((n, i) => n + o.transform.position[i]) as Vec3;
}
