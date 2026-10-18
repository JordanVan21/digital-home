import type { Quat, Vec3 } from "@house/contracts";
/** Quaternion math stays independent of the rendering library. Euler UI uses YXZ. */
export const multiplyRotation = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const inverseRotation = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function rotateVector(v: Vec3, q: Quat): Vec3 {
  const p = multiplyRotation(
    multiplyRotation(q, [...v, 0]),
    inverseRotation(q),
  );
  return [p[0], p[1], p[2]];
}
export function rotationFromDegrees([x, y, z]: Vec3): Quat {
  const [a, b, c] = [x, y, z].map((n) => (n * Math.PI) / 360);
  return multiplyRotation(
    multiplyRotation(
      [0, Math.sin(b), 0, Math.cos(b)],
      [Math.sin(a), 0, 0, Math.cos(a)],
    ),
    [0, 0, Math.sin(c), Math.cos(c)],
  );
}
export function rotationDegrees(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const m23 = 2 * (y * z - x * w),
    m13 = 2 * (x * z + y * w),
    m33 = 1 - 2 * (x * x + y * y),
    m21 = 2 * (x * y + z * w),
    m22 = 1 - 2 * (x * x + z * z);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
  const turn =
    Math.abs(m23) < 0.9999999
      ? Math.atan2(m13, m33)
      : Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z));
  const roll = Math.abs(m23) < 0.9999999 ? Math.atan2(m21, m22) : 0;
  return [pitch, turn, roll].map((n) => (n * 180) / Math.PI) as Vec3;
}
export function worldYaw(q: Quat, delta: number): Quat {
  return multiplyRotation([0, Math.sin(delta / 2), 0, Math.cos(delta / 2)], q);
}
