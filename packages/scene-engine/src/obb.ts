import type { SceneObject, Tilt, Vec2, Vec3 } from '@house/contracts';
import { add2, dot2, frontDir, rightDir, scale2, sub2, yawFromQuat } from './math';

/** Oriented box: footprint rectangle in XZ plus a vertical interval. */
export type OBB = {
  center: Vec2;
  /** Unit axes: u = local +X (width), v = local +Z (depth/front). */
  u: Vec2;
  v: Vec2;
  halfW: number;
  halfD: number;
  yMin: number;
  yMax: number;
};

/**
 * Box from a pose and size. `position` is the base-center of the footprint;
 * `dimensionsM` is [w, h, d]. Never derived from rendered meshes.
 */
export function obbFromPose(position: Vec3, yaw: number, dimensionsM: Vec3): OBB {
  const [w, h, d] = dimensionsM;
  return {
    center: [position[0], position[2]],
    u: rightDir(yaw),
    v: frontDir(yaw),
    halfW: w / 2,
    halfD: d / 2,
    yMin: position[1],
    yMax: position[1] + h,
  };
}

/** Size after decor tilt: quarter turns about X swap h/d, then about Z swap w/h. */
export function effectiveDims(dims: Vec3, tilt?: Tilt): Vec3 {
  let [w, h, d] = dims;
  if (tilt && tilt.x % 2 === 1) [h, d] = [d, h];
  if (tilt && tilt.z % 2 === 1) [w, h] = [h, w];
  return [w, h, d];
}

/** The object's overall box (effective size after tilt). */
export function obbOf(obj: Pick<SceneObject, 'transform' | 'dimensionsM'> & { tilt?: Tilt }): OBB {
  return obbFromPose(obj.transform.position, yawFromQuat(obj.transform.rotation), effectiveDims(obj.dimensionsM, obj.tilt));
}

/** Footprint corners in XZ, ordered counter-clockwise as viewed from +Y. */
export function obbCorners(b: OBB): Vec2[] {
  const U = scale2(b.u, b.halfW);
  const V = scale2(b.v, b.halfD);
  // (-W,-D) → (-W,+D) → (+W,+D) → (+W,-D) is CCW from above for an unrotated box (shoelace < 0).
  return [
    sub2(sub2(b.center, U), V),
    add2(sub2(b.center, U), V),
    add2(add2(b.center, U), V),
    sub2(add2(b.center, U), V),
  ];
}

export function footprintCorners(obj: Pick<SceneObject, 'transform' | 'dimensionsM'>): Vec2[] {
  return obbCorners(obbOf(obj));
}

function projectRadius(b: OBB, axis: Vec2): number {
  return b.halfW * Math.abs(dot2(b.u, axis)) + b.halfD * Math.abs(dot2(b.v, axis));
}

/**
 * Minimum penetration depth on XZ by the Separating Axis Theorem; ≤ 0 means separated or touching.
 */
export function obbPenetrationXZ(a: OBB, b: OBB): number {
  const d = sub2(b.center, a.center);
  let minOverlap = Infinity;
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const overlap = projectRadius(a, axis) + projectRadius(b, axis) - Math.abs(dot2(d, axis));
    if (overlap < minOverlap) minOverlap = overlap;
    if (minOverlap <= 0) return minOverlap;
  }
  return minOverlap;
}

export function verticalOverlap(a: OBB, b: OBB): number {
  return Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
}

/** 3D overlap with tolerance: touching faces/edges (within `tol`) are not overlaps. */
export function obbOverlap(a: OBB, b: OBB, tol = 1e-3): boolean {
  return verticalOverlap(a, b) > tol && obbPenetrationXZ(a, b) > tol;
}

/** True when every footprint corner of `inner` lies within `outer`'s footprint (± tol). */
export function obbContainsXZ(outer: OBB, inner: OBB, tol = 1e-3): boolean {
  return obbCorners(inner).every((p) => {
    const r = sub2(p, outer.center);
    return Math.abs(dot2(r, outer.u)) <= outer.halfW + tol && Math.abs(dot2(r, outer.v)) <= outer.halfD + tol;
  });
}

/** Axis-aligned XZ bounds of an OBB, for broad-phase. */
export function obbAabbXZ(b: OBB): { min: Vec2; max: Vec2 } {
  const ex = projectRadius(b, [1, 0]);
  const ez = projectRadius(b, [0, 1]);
  return { min: [b.center[0] - ex, b.center[1] - ez], max: [b.center[0] + ex, b.center[1] + ez] };
}

export type Penetration = { depth: number; /** Unit push direction for `a` (world). */ axis: Vec3 };

/**
 * Full 3D SAT for yaw-aligned boxes (both share the Y axis, so the separating axes reduce to the
 * four footprint axes plus Y). Returns the minimum penetration and the push direction for `a`,
 * or null when separated (depth ≤ 0).
 */
export function obbPenetration3D(a: OBB, b: OBB): Penetration | null {
  const dy = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  if (dy <= 0) return null;
  const d = sub2(a.center, b.center);
  let best: Penetration = { depth: dy, axis: [0, (a.yMin + a.yMax) >= (b.yMin + b.yMax) ? 1 : -1, 0] };
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const dd = dot2(d, axis);
    const overlap = projectRadius(a, axis) + projectRadius(b, axis) - Math.abs(dd);
    if (overlap <= 0) return null;
    if (overlap < best.depth) {
      const s = dd >= 0 ? 1 : -1;
      best = { depth: overlap, axis: [axis[0] * s, 0, axis[1] * s] };
    }
  }
  return best;
}

/** Horizontal-only minimum translation (for sliding drags), or null if not overlapping in 3D. */
export function obbMtvXZ(a: OBB, b: OBB): { depth: number; dir: Vec2 } | null {
  const dy = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  if (dy <= 0) return null;
  const d = sub2(a.center, b.center);
  let best: { depth: number; dir: Vec2 } | null = null;
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const dd = dot2(d, axis);
    const overlap = projectRadius(a, axis) + projectRadius(b, axis) - Math.abs(dd);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const s = dd >= 0 ? 1 : -1;
      best = { depth: overlap, dir: [axis[0] * s, axis[1] * s] };
    }
  }
  return best;
}

export function translateObb(b: OBB, dx: number, dz: number, dy = 0): OBB {
  return { ...b, center: [b.center[0] + dx, b.center[1] + dz], yMin: b.yMin + dy, yMax: b.yMax + dy };
}
