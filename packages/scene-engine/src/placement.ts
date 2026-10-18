import type { RoomShell, SceneObject, SceneSpec, Vec2, Vec3 } from '@house/contracts';
import { add2, dot2, makeTransform, scale2, sub2 } from './math';
import type { WallFrame } from './shell';
import { pointInPolygonStrict, pointSegmentDistance, polygonBounds, polygonCentroid } from './polygon';
import { classOf, indexObjects, prepareShell, validateObject, type RuleContext, type Violation } from './rules';

export type SpotSearchOptions = {
  /** Ring spacing (m). */
  step: number;
  /** Maximum search radius (m). */
  maxRadius: number;
  /** Object ids to ignore (e.g. the original when duplicating is fine to keep — leave empty). */
  ignoreIds?: readonly string[];
};

export const DEFAULT_SPOT_SEARCH: SpotSearchOptions = { step: 0.1, maxRadius: 6 };

export type SpotResult = {
  position: Vec3;
  /** True when a violation-free spot was found. */
  found: boolean;
  violations: Violation[];
};

function withPosition(obj: SceneObject, x: number, z: number): SceneObject {
  return { ...obj, transform: { ...obj.transform, position: [x, obj.transform.position[1], z] } };
}

/**
 * Spiral search outward from `start` for the nearest XZ position where `obj` has no violations.
 * If none exists within range, returns the best (fewest-violation, error-free if possible) spot
 * inside the room, flagged `found: false`.
 */
export function findFreeSpot(
  ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, obj: SceneObject, start: Vec2, opts: Partial<SpotSearchOptions> = {},
): SpotResult {
  const o = { ...DEFAULT_SPOT_SEARCH, ...opts };
  const ignore = new Set(o.ignoreIds ?? []);
  const others = scene.objects.filter((x) => x.id !== obj.id && !ignore.has(x.id));
  const index = indexObjects([...others, obj]);
  const polygon = prepareShell(ctx.shell).polygon;
  const cls = classOf(ctx, obj);
  // Surface/wall items are positioned relative to their support; only floor-like items spiral freely.
  const evaluate = (x: number, z: number) => {
    const cand = withPosition(obj, x, z);
    index.set(cand.id, cand);
    return validateObject(ctx, index, cand, others);
  };

  let best: SpotResult | null = null;
  const consider = (x: number, z: number): boolean => {
    const v = evaluate(x, z);
    const pos: Vec3 = [x, obj.transform.position[1], z];
    if (v.length === 0) {
      best = { position: pos, found: true, violations: [] };
      return true;
    }
    const errs = v.filter((e) => e.severity === 'error').length;
    const bestErrs = best ? best.violations.filter((e) => e.severity === 'error').length : Infinity;
    if (!best || errs < bestErrs || (errs === bestErrs && v.length < best.violations.length)) {
      best = { position: pos, found: false, violations: v };
    }
    return false;
  };

  if (consider(start[0], start[1])) return best!;
  if (cls !== 'wall' && cls !== 'surface') {
    for (let r = o.step; r <= o.maxRadius + 1e-9; r += o.step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / o.step));
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n;
        const x = start[0] + r * Math.cos(a);
        const z = start[1] + r * Math.sin(a);
        if (!pointInPolygonStrict([x, z], polygon)) continue;
        if (consider(x, z)) return best!;
      }
    }
  }
  if (!best || (best as SpotResult).violations.some((e) => e.severity === 'error')) {
    // Fall back to an interior point (centroid if inside, else bounds center).
    const c = polygonCentroid(polygon);
    const b = polygonBounds(polygon);
    const p: Vec2 = pointInPolygonStrict(c, polygon) ? c : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    const v = evaluate(p[0], p[1]);
    const cur = best as SpotResult | null;
    const curErrs = cur ? cur.violations.filter((e) => e.severity === 'error').length : Infinity;
    if (v.filter((e) => e.severity === 'error').length < curErrs) {
      best = { position: [p[0], obj.transform.position[1], p[1]], found: false, violations: v };
    }
  }
  return best!;
}

export type WallPose = { position: Vec3; yaw: number; wallId: string };

/**
 * Pose for a wall item near `near` (XZ): back face flush on the nearest wall, front facing into
 * the room, centered at height `centerY`, clamped to stay within the wall's length.
 */
export function wallPose(shell: RoomShell, dimensionsM: Vec3, near: Vec2, centerY: number): WallPose | null {
  const frames = prepareShell(shell).walls;
  let best: WallFrame | null = null;
  let bestD = Infinity;
  for (const f of frames) {
    const d = pointSegmentDistance(near, f.from, f.to);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) return null;
  const [w, h, d] = dimensionsM;
  const half = Math.min(w / 2, best.length / 2);
  const s = Math.max(half, Math.min(best.length - half, dot2(sub2(near, best.from), best.dir)));
  const back = add2(best.from, scale2(best.dir, s));
  const c = add2(back, scale2(best.inward, d / 2));
  return { position: [c[0], Math.max(0, centerY - h / 2), c[1]], yaw: best.inwardYaw, wallId: best.wall.id };
}

/** Slide a wall item along its wall (alternating sides) to the nearest violation-free spot. */
export function findWallSpot(
  ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, obj: SceneObject, near: Vec2, centerY: number, stepM = 0.05,
): SpotResult & { yaw: number } {
  const pose = wallPose(ctx.shell, obj.dimensionsM, near, centerY);
  if (!pose) return { position: obj.transform.position, found: false, violations: [], yaw: 0 };
  const frame = prepareShell(ctx.shell).walls.find((f) => f.wall.id === pose.wallId)!;
  const others = scene.objects.filter((x) => x.id !== obj.id);
  const index = indexObjects(others);
  let first: (SpotResult & { yaw: number }) | null = null;
  const maxK = Math.ceil(frame.length / stepM);
  for (let k = 0; k <= maxK; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const p: Vec2 = [pose.position[0] + frame.dir[0] * stepM * k * sign, pose.position[2] + frame.dir[1] * stepM * k * sign];
      const cand: SceneObject = { ...obj, transform: makeTransform([p[0], pose.position[1], p[1]], pose.yaw) };
      index.set(cand.id, cand);
      const v = validateObject(ctx, index, cand, others);
      const r = { position: cand.transform.position, found: v.length === 0, violations: v, yaw: pose.yaw };
      if (!first) first = r;
      if (r.found) return r;
    }
  }
  return first!;
}
