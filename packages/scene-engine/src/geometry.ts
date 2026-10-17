import type { RoomShell, SceneObject, Vec3 } from "@house/contracts";
export type Point = [number, number];
export const EPS = 1e-7;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
export function yawOf(q: [number, number, number, number]): number {
  return Math.atan2(
    2 * (q[3] * q[1] + q[0] * q[2]),
    1 - 2 * (q[1] * q[1] + q[2] * q[2]),
  );
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
  return rectangle(
    [o.transform.position[0], o.transform.position[2]],
    o.dimensionsM[0] * o.transform.scale[0],
    o.dimensionsM[2] * o.transform.scale[2],
    yawOf(o.transform.rotation),
  );
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
      const depth = o.widthM + 0.15;
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
export function scaledDimensions(o: SceneObject): Vec3 {
  return o.dimensionsM.map((d, i) => d * o.transform.scale[i]) as Vec3;
}
