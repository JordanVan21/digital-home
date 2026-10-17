import type { Vec3 } from "@house/contracts";

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
