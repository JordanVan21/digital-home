import type { Quat, Transform, Vec2, Vec3 } from '@house/contracts';

/**
 * Axis conventions (see SANDBOX_NOTES.md §3d):
 * - Right-handed, Y up. Yaw is radians about +Y, same sign as Three's `rotation.y`.
 * - At yaw 0 an object's width runs along +X, depth along +Z, and its front faces +Z.
 * - 2D helpers work on (x, z) pairs.
 */

export const EPS = 1e-9;

export function quatFromYaw(yaw: number): Quat {
  const h = yaw / 2;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** Yaw of a (Y-axis-only) quaternion, normalized to (-π, π]. */
export function yawFromQuat(q: Quat): number {
  const [, y, , w] = q;
  return normalizeAngle(2 * Math.atan2(y, w));
}

/** True when the quaternion is a unit rotation about +Y only. */
export function isYawOnlyQuat(q: Quat, tol = 1e-6): boolean {
  const [x, y, z, w] = q;
  const len = Math.hypot(x, y, z, w);
  return Math.abs(len - 1) <= 1e-4 && Math.abs(x) <= tol && Math.abs(z) <= tol;
}

export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Smallest absolute difference between two angles, in [0, π]. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/**
 * Rotate a local (x, z) offset by yaw, matching Three's rotation.y:
 * x' = x·cos + z·sin, z' = −x·sin + z·cos.
 */
export function rotateXZ([x, z]: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** Unit direction of the object's local +Z (its front) in world XZ. */
export function frontDir(yaw: number): Vec2 {
  return [Math.sin(yaw), Math.cos(yaw)];
}

/** Unit direction of the object's local +X (its width axis) in world XZ. */
export function rightDir(yaw: number): Vec2 {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const normalize2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
};

export const xzOf = (p: Vec3): Vec2 => [p[0], p[2]];

export function yawOf(t: Transform): number {
  return yawFromQuat(t.rotation);
}

export function makeTransform(position: Vec3, yaw: number): Transform {
  return { position: [...position] as Vec3, rotation: quatFromYaw(yaw), scale: [1, 1, 1] };
}

export function transformsEqual(a: Transform, b: Transform, tol = 0): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) <= tol;
  return a.position.every((v, i) => eq(v, b.position[i]!))
    && a.rotation.every((v, i) => eq(v, b.rotation[i]!))
    && a.scale.every((v, i) => eq(v, b.scale[i]!));
}
