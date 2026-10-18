import { rotateVector, rotationDegrees } from "./rotation";
import type { RoomShell, SceneObject, Tilt, Vec3 } from "@house/contracts";
export type Point = [number, number];
export const EPS = 1e-7;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
export function yawOf(q: [number, number, number, number]): number {
  return (rotationDegrees(q)[1] * Math.PI) / 180;
}
export function rectangle(
  center: Point,
  width: number,
  depth: number,
  yaw = 0,
): Point[] {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Point[]
  ).map(([x, z]) => [
    center[0] + (c * x * width) / 2 + (s * z * depth) / 2,
    center[1] - (s * x * width) / 2 + (c * z * depth) / 2,
  ]);
}
export function footprint(o: SceneObject): Point[] {
  return convexHull(boxCorners(o).map((p) => [p[0], p[2]]));
}
/** SAT: a shared edge or corner is allowed, positive-area intersection is not. */
export function overlaps(a: Point[], b: Point[]): boolean {
  for (const p of [a, b])
    for (let i = 0; i < p.length; i++) {
      const edge = sub(p[(i + 1) % p.length], p[i]);
      const axis: Point = [-edge[1], edge[0]];
      const length = Math.hypot(...axis);
      if (length < EPS) continue;
      axis[0] /= length;
      axis[1] /= length;
      const aa = a.map((v) => dot(v, axis)),
        bb = b.map((v) => dot(v, axis));
      if (
        Math.min(Math.max(...aa), Math.max(...bb)) -
          Math.max(Math.min(...aa), Math.min(...bb)) <=
        EPS
      )
        return false;
    }
  return true;
}
export function insidePoint(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i],
      ab = sub(b, a),
      ap = sub(p, a);
    if (
      Math.abs(cross(ab, ap)) < EPS &&
      dot(ap, ab) >= -EPS &&
      dot(ap, ab) <= dot(ab, ab) + EPS
    )
      return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Check edge intervals too: corners alone fail for concave rooms. */
export function insidePolygon(rect: Point[], poly: Point[]): boolean {
  if (!rect.every((p) => insidePoint(p, poly))) return false;
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i],
      d = sub(rect[(i + 1) % rect.length], a),
      cuts = [0, 1];
    for (let j = 0; j < poly.length; j++) {
      const b = poly[j],
        e = sub(poly[(j + 1) % poly.length], b),
        den = cross(d, e);
      if (Math.abs(den) < EPS) continue;
      const t = cross(sub(b, a), e) / den,
        u = cross(sub(b, a), d) / den;
      if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j - 1] + cuts[j]) / 2;
      if (!insidePoint([a[0] + d[0] * t, a[1] + d[1] * t], poly)) return false;
    }
  }
  return true;
}
export function wallFootprints(room: RoomShell): Point[][] {
  return room.walls.map((w) =>
    rectangle(
      [(w.fromXZ[0] + w.toXZ[0]) / 2, (w.fromXZ[1] + w.toXZ[1]) / 2],
      Math.hypot(w.toXZ[0] - w.fromXZ[0], w.toXZ[1] - w.fromXZ[1]),
      w.thicknessM,
      -Math.atan2(w.toXZ[1] - w.fromXZ[1], w.toXZ[0] - w.fromXZ[0]),
    ),
  );
}
export const SLIDING_DOOR_WALKWAY_M = 0.9;
export function doorClearances(room: RoomShell): Point[][] {
  return room.openings
    .filter((o) => o.kind === "door")
    .map((o) => {
      const w = room.walls.find((w) => w.id === o.wallId)!;
      const dx = w.toXZ[0] - w.fromXZ[0],
        dz = w.toXZ[1] - w.fromXZ[1],
        len = Math.hypot(dx, dz),
        ux = dx / len,
        uz = dz / len;
      const mid: Point = [
        w.fromXZ[0] + ux * (o.offsetM + o.widthM / 2),
        w.fromXZ[1] + uz * (o.offsetM + o.widthM / 2),
      ];
      const sign = insidePoint(
        [mid[0] - uz * 0.02, mid[1] + ux * 0.02],
        room.floor.polygonXZ,
      )
        ? 1
        : -1;
      // A swinging door needs its arc clear; a sliding door only a walkway.
      const depth =
        o.swing === "none" ? SLIDING_DOOR_WALKWAY_M : o.widthM + 0.15;
      return rectangle(
        [
          mid[0] - ((uz * depth) / 2) * sign,
          mid[1] + ((ux * depth) / 2) * sign,
        ],
        o.widthM + 0.1,
        depth,
        -Math.atan2(dz, dx),
      );
    });
}
/**
 * Size after decor tilt. `dimensionsM` is the model's own upright size; quarter
 * turns about X swap height and depth, then turns about Z swap width and height.
 */
export function tiltedDimensions(size: Vec3, tilt?: Tilt): Vec3 {
  let [w, h, d] = size;
  if (tilt && tilt.x % 2 === 1) [h, d] = [d, h];
  if (tilt && tilt.z % 2 === 1) [w, h] = [h, w];
  return [w, h, d];
}
/** World size of the object's box: scaled, then tilted. */
export function scaledDimensions(o: SceneObject): Vec3 {
  return tiltedDimensions(
    o.dimensionsM.map((d, i) => d * o.transform.scale[i]) as Vec3,
    o.tilt,
  );
}

/** Convex projected silhouette, including the vertical extent of tipped pieces. */
export function convexHull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (
        out.length >= 2 &&
        cross(
          sub(out[out.length - 1], out[out.length - 2]),
          sub(p, out[out.length - 1]),
        ) <= EPS
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  const a = half(sorted),
    b = half(sorted.slice().reverse());
  a.pop();
  b.pop();
  return [...a, ...b];
}
export function boxCorners(
  o: SceneObject,
  min = [0, 0, 0],
  max = [1, 1, 1],
): Vec3[] {
  const size = scaledDimensions(o);
  const points: Vec3[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const p = rotateVector(
          [(x - 0.5) * size[0], y * size[1], (z - 0.5) * size[2]],
          o.transform.rotation,
        );
        points.push(p.map((v, i) => v + o.transform.position[i]) as Vec3);
      }
  return points;
}
export function verticalBounds(o: SceneObject) {
  const ys = boxCorners(o).map((p) => p[1]);
  return { bottom: Math.min(...ys), top: Math.max(...ys) };
}
