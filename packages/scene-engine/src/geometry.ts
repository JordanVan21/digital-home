import type { Quat, Vec3 } from "@house/contracts";

/** Ray-casting point-in-polygon test on the XZ plane. Polygon is implicitly closed. */
export function pointInPolygonXZ(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const intersects =
      zi > point[1] !== zj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isFiniteVec3(v: Vec3): boolean {
  return v.every((n) => Number.isFinite(n));
}

export function isFiniteQuat(q: readonly number[]): boolean {
  return q.every((n) => Number.isFinite(n));
}

/** All object rotation in this app is yaw-only (about world Y). Radians. */
export function yawRadiansFromQuaternion([x, y, z, w]: Quat): number {
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

export function quaternionFromYawRadians(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** A 2D oriented bounding box on the XZ plane, used for footprint overlap tests. */
export interface OBB {
  center: [number, number];
  /** Half-width along the box's own (possibly rotated) X and Z axes. */
  halfExtents: [number, number];
  yaw: number;
}

export function obbCorners({ center, halfExtents, yaw }: OBB): [number, number][] {
  const [hx, hz] = halfExtents;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  // three.js Ry(θ): local +X -> world (cosθ, -sinθ), local +Z -> world
  // (sinθ, cosθ), in the (x,z) plane — same convention yawRadiansFromQuaternion
  // decodes and TransformControls' rotate gizmo writes.
  return local.map(([lx, lz]) => [
    center[0] + lx * cos + lz * sin,
    center[1] - lx * sin + lz * cos,
  ]);
}

function obbAxes({ yaw }: OBB): [number, number][] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

function projectOntoAxis(corners: [number, number][], axis: [number, number]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, z] of corners) {
    const p = x * axis[0] + z * axis[1];
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  return [min, max];
}

/** Separating Axis Theorem overlap test for two (possibly rotated) OBBs. */
export function obbOverlap(a: OBB, b: OBB): boolean {
  const cornersA = obbCorners(a);
  const cornersB = obbCorners(b);
  const axes = [...obbAxes(a), ...obbAxes(b)];
  for (const axis of axes) {
    const [minA, maxA] = projectOntoAxis(cornersA, axis);
    const [minB, maxB] = projectOntoAxis(cornersB, axis);
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}
