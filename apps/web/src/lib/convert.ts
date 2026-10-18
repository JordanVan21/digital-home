import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { SceneObject, Transform, Vec3 } from '@house/contracts';
import { makeTransform, yawFromQuat } from '@house/scene-engine';

/**
 * Boundary between scene-engine math (plain arrays, yaw-only quaternions) and Three objects.
 * scene-engine's yaw has the same sign as Three's rotation.y (see axis test in scene-engine).
 */

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _f = new Vector3();

export function matrixOf(t: Transform, out = new Matrix4()): Matrix4 {
  return out.compose(_p.set(...t.position), _q.set(...t.rotation), _s.set(1, 1, 1));
}

/** World transform of an Object3D, flattened to position + yaw (any pitch/roll is discarded). */
export function worldTransformOf(o: Object3D): Transform {
  o.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(_p, _q, _s);
  _f.set(0, 0, 1).applyQuaternion(_q);
  return makeTransform([_p.x, _p.y, _p.z], Math.atan2(_f.x, _f.z));
}

/** Local transform of `child` expressed in `parent`'s frame (both world, yaw-only). */
export function relativeTransform(child: Transform, parent: Transform): { position: Vec3; rotation: [number, number, number, number] } {
  const inv = matrixOf(parent).invert();
  const m = matrixOf(child).premultiply(inv);
  m.decompose(_p, _q, _s);
  return { position: [_p.x, _p.y, _p.z], rotation: [_q.x, _q.y, _q.z, _q.w] };
}

/** Write an object's stored transform onto its Three group (relative to its parent if nested). */
export function applyObjectTransform(group: Object3D, obj: SceneObject, parent?: SceneObject): void {
  const t = parent ? relativeTransform(obj.transform, parent.transform) : obj.transform;
  group.position.set(...t.position);
  group.quaternion.set(...t.rotation);
  group.updateMatrixWorld();
}

export const yawOf = (t: Transform) => yawFromQuat(t.rotation);
