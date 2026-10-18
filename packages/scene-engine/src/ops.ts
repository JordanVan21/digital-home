import {
  SceneObjectSchema, SceneOpSchema,
  type SceneObject, type SceneOp, type SceneSpec, type Transform,
} from '@house/contracts';
import { isTiltable } from './config';
import { isYawOnlyQuat, quatFromYaw, rotateXZ, yawFromQuat } from './math';
import { indexObjects, singleObjectViolations, type ObjectIndex, type RuleContext } from './rules';

export type OpErrorReason =
  | 'UNSUPPORTED_OP'
  | 'SHELL_IMMUTABLE'
  | 'INVALID_OP'
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'LOCKED'
  | 'CHILD_LOCKED'
  | 'INVALID_TRANSFORM'
  | 'INVALID_DIMENSIONS'
  | 'INVALID_PARENT'
  | 'ASSET_UNAVAILABLE'
  | 'CATEGORY_MISMATCH'
  | 'HAS_CHILDREN'
  | 'NOT_TILTABLE'
  | 'GEOMETRY';

export type OpError = {
  code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ASSET_UNAVAILABLE';
  reason: OpErrorReason;
  message: string;
  objectId?: string;
  opIndex?: number;
};

export type OpContext = RuleContext & {
  /**
   * 'enforce' (default): reject ops that introduce a new error-severity geometry violation
   * (e.g. footprint outside the room) on the objects they touch.
   * 'report': skip geometry rejection — used when replaying inverse ops for undo/redo.
   */
  geometry?: 'enforce' | 'report';
};

export type OpResult =
  | { ok: true; scene: SceneSpec; inverse: SceneOp[]; affected: string[] }
  | { ok: false; error: OpError };

const fail = (reason: OpErrorReason, message: string, objectId?: string): { ok: false; error: OpError } => ({
  ok: false,
  error: {
    code: reason === 'NOT_FOUND' ? 'NOT_FOUND' : reason === 'ASSET_UNAVAILABLE' ? 'ASSET_UNAVAILABLE' : 'VALIDATION_ERROR',
    reason, message, ...(objectId ? { objectId } : {}),
  },
});

/** Children of `id`, recursively, parents before children. */
export function descendantsOf(objects: readonly SceneObject[], id: string): SceneObject[] {
  const out: SceneObject[] = [];
  const queue = [id];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const o of objects) {
      if (o.placement?.parentId === cur && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
        queue.push(o.id);
      }
    }
  }
  return out;
}

function checkTransform(t: Transform): string | null {
  if (!isYawOnlyQuat(t.rotation)) return 'Rotation must be a unit rotation about +Y only.';
  if (t.scale.some((s) => s !== 1)) return 'transform.scale must be [1,1,1]; size lives in dimensionsM.';
  return null;
}

/** Structural checks for an object entering the scene. */
function checkObject(ctx: OpContext, index: ObjectIndex, obj: SceneObject): { ok: false; error: OpError } | null {
  const tErr = checkTransform(obj.transform);
  if (tErr) return fail('INVALID_TRANSFORM', tErr, obj.id);
  if (obj.dimensionsM.some((d) => !(d > 0))) return fail('INVALID_DIMENSIONS', 'Dimensions must be positive.', obj.id);
  const parentId = obj.placement?.parentId;
  if (parentId !== undefined) {
    if (parentId === obj.id) return fail('INVALID_PARENT', 'An object cannot be its own parent.', obj.id);
    if (!index.has(parentId)) return fail('INVALID_PARENT', 'Parent object does not exist.', obj.id);
  }
  if (obj.assetId) {
    const aErr = checkAsset(ctx, obj.assetId, obj.category, obj.id);
    if (aErr) return aErr;
  }
  return checkTilt(ctx, obj, obj.tilt);
}

function checkTilt(ctx: OpContext, obj: SceneObject, tilt: SceneObject['tilt']) {
  if (!tilt || (tilt.x === 0 && tilt.z === 0)) return null;
  const asset = obj.assetId ? ctx.assets?.(obj.assetId) : undefined;
  return isTiltable(obj.category, asset) ? null : fail('NOT_TILTABLE', 'Only small decor can be tilted; furniture stays upright.', obj.id);
}

/** Would making `parentId` the parent of `id` create a cycle? */
function wouldCycle(index: ObjectIndex, id: string, parentId: string): boolean {
  let cur: string | undefined = parentId;
  for (let guard = 0; cur && guard < 64; guard++) {
    if (cur === id) return true;
    cur = index.get(cur)?.placement?.parentId;
  }
  return false;
}

function checkAsset(ctx: OpContext, assetId: string, category: string, objectId: string) {
  if (!ctx.assets) return null;
  const asset = ctx.assets(assetId);
  if (!asset) return fail('ASSET_UNAVAILABLE', `Unknown asset ${assetId}.`, objectId);
  if (asset.licenseStatus !== 'verified') return fail('ASSET_UNAVAILABLE', `Asset ${assetId} is not license-verified.`, objectId);
  if (asset.category !== category) return fail('CATEGORY_MISMATCH', `Asset category ${asset.category} ≠ object category ${category}.`, objectId);
  return null;
}

/** World transform of a descendant after its ancestor moves from `from` to `to` (rigid carry). */
export function carryTransform(child: Transform, from: Transform, to: Transform): Transform {
  const dy = to.position[1] - from.position[1];
  const sameRotation = from.rotation.every((v, i) => v === to.rotation[i]);
  if (sameRotation) {
    return {
      ...child,
      position: [
        child.position[0] + (to.position[0] - from.position[0]),
        child.position[1] + dy,
        child.position[2] + (to.position[2] - from.position[2]),
      ],
    };
  }
  const yawFrom = yawFromQuat(from.rotation);
  const yawTo = yawFromQuat(to.rotation);
  const rel = rotateXZ([child.position[0] - from.position[0], child.position[2] - from.position[2]], -yawFrom);
  const [rx, rz] = rotateXZ(rel, yawTo);
  return {
    position: [to.position[0] + rx, child.position[1] + dy, to.position[2] + rz],
    rotation: quatFromYaw(yawFromQuat(child.rotation) + (yawTo - yawFrom)),
    scale: child.scale,
  };
}

function errorRules(ctx: OpContext, index: ObjectIndex, obj: SceneObject): Set<string> {
  return new Set(singleObjectViolations(ctx, index, obj).filter((v) => v.severity === 'error').map((v) => v.rule));
}

/**
 * Reject when the op introduces an error-severity violation that the affected object didn't
 * already have (pre-existing scan errors never block unrelated edits).
 */
function enforceGeometry(ctx: OpContext, before: SceneSpec, after: SceneSpec, affected: string[]) {
  if (ctx.geometry === 'report') return null;
  const ib = indexObjects(before.objects);
  const ia = indexObjects(after.objects);
  for (const id of affected) {
    const objA = ia.get(id);
    if (!objA) continue;
    const objB = ib.get(id);
    const prev = objB ? errorRules(ctx, ib, objB) : new Set<string>();
    for (const v of singleObjectViolations(ctx, ia, objA)) {
      if (v.severity === 'error' && !prev.has(v.rule)) return fail('GEOMETRY', v.detail, id);
    }
  }
  return null;
}

const SHELL_HINT = /shell|wall|opening|floor|window|door/i;

/**
 * Apply one contract operation. Pure: never mutates `scene`. Returns the new scene and the
 * inverse operations that restore it exactly (in order).
 */
export function applyOp(ctx: OpContext, scene: SceneSpec, rawOp: SceneOp): OpResult {
  const typeName = String((rawOp as { type?: unknown })?.type ?? '');
  const parsed = SceneOpSchema.safeParse(rawOp);
  if (!parsed.success) {
    if (!['add', 'delete', 'move', 'replaceAsset', 'replacePhysicalItem', 'changeMaterial', 'setLock', 'setRenovationDecision',
      'setPlacement', 'resize', 'setTilt', 'setGroup', 'setLight', 'setSceneSettings'].includes(typeName)) {
      return SHELL_HINT.test(typeName)
        ? fail('SHELL_IMMUTABLE', 'The room shell is immutable; no operation may modify it.')
        : fail('UNSUPPORTED_OP', `Unsupported operation "${typeName}".`);
    }
    return fail('INVALID_OP', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const op = parsed.data;
  const index = indexObjects(scene.objects);
  const withObjects = (objects: SceneObject[]): SceneSpec => ({ ...scene, objects });

  switch (op.type) {
    case 'add': {
      const obj = op.object;
      if (index.has(obj.id)) return fail('DUPLICATE_ID', `Object ${obj.id} already exists.`, obj.id);
      const err = checkObject(ctx, index, obj);
      if (err) return err;
      const next = withObjects([...scene.objects, obj]);
      const gErr = enforceGeometry(ctx, scene, next, [obj.id]);
      if (gErr) return gErr;
      return { ok: true, scene: next, inverse: [{ type: 'delete', objectId: obj.id }], affected: [obj.id] };
    }

    case 'delete': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      const desc = descendantsOf(scene.objects, obj.id);
      const lockedChild = desc.find((d) => d.locked);
      if (lockedChild) return fail('CHILD_LOCKED', `${lockedChild.displayName} on it is locked.`, lockedChild.id);
      const removed = new Set([obj.id, ...desc.map((d) => d.id)]);
      return {
        ok: true,
        scene: withObjects(scene.objects.filter((o) => !removed.has(o.id))),
        inverse: [obj, ...desc].map((o) => ({ type: 'add', object: o }) as SceneOp),
        affected: [...removed],
      };
    }

    case 'move': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      const tErr = checkTransform(op.transform);
      if (tErr) return fail('INVALID_TRANSFORM', tErr, obj.id);
      const desc = descendantsOf(scene.objects, obj.id);
      const lockedChild = desc.find((d) => d.locked);
      if (lockedChild) return fail('CHILD_LOCKED', `${lockedChild.displayName} on it is locked.`, lockedChild.id);
      const moved = new Map<string, SceneObject>([[obj.id, { ...obj, transform: op.transform }]]);
      for (const d of desc) moved.set(d.id, { ...d, transform: carryTransform(d.transform, obj.transform, op.transform) });
      const next = withObjects(scene.objects.map((o) => moved.get(o.id) ?? o));
      const affected = [obj.id, ...desc.map((d) => d.id)];
      const gErr = enforceGeometry(ctx, scene, next, affected);
      if (gErr) return gErr;
      // Restore the parent, then pin each descendant to its exact previous transform.
      const inverse: SceneOp[] = [
        { type: 'move', objectId: obj.id, transform: obj.transform },
        ...desc.map((d) => ({ type: 'move', objectId: d.id, transform: d.transform }) as SceneOp),
      ];
      return { ok: true, scene: next, inverse, affected };
    }

    case 'replaceAsset': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      if (op.dimensionsM.some((d) => !(d > 0))) return fail('INVALID_DIMENSIONS', 'Dimensions must be positive.', obj.id);
      if (op.assetId) {
        const aErr = checkAsset(ctx, op.assetId, obj.category, obj.id);
        if (aErr) return aErr;
      }
      const next = withObjects(scene.objects.map((o) => (o.id === obj.id ? { ...o, assetId: op.assetId, dimensionsM: op.dimensionsM } : o)));
      const gErr = enforceGeometry(ctx, scene, next, [obj.id]);
      if (gErr) return gErr;
      return {
        ok: true, scene: next, affected: [obj.id],
        inverse: [{ type: 'replaceAsset', objectId: obj.id, assetId: obj.assetId, dimensionsM: obj.dimensionsM }],
      };
    }

    case 'replacePhysicalItem': {
      const old = index.get(op.oldObjectId);
      if (!old) return fail('NOT_FOUND', 'Object not found.', op.oldObjectId);
      if (old.locked) return fail('LOCKED', `${old.displayName} is locked.`, old.id);
      if (descendantsOf(scene.objects, old.id).length) return fail('HAS_CHILDREN', 'Move items off it before replacing it.', old.id);
      const newObj: SceneObject = { ...op.newObject, replacesObjectId: old.id };
      if (index.has(newObj.id)) return fail('DUPLICATE_ID', `Object ${newObj.id} already exists.`, newObj.id);
      const err = checkObject(ctx, index, newObj);
      if (err) return err;
      const next = withObjects(scene.objects.map((o) => (o.id === old.id ? newObj : o)));
      const gErr = enforceGeometry(ctx, scene, next, [newObj.id]);
      if (gErr) return gErr;
      return {
        ok: true, scene: next, affected: [old.id, newObj.id],
        inverse: [{ type: 'delete', objectId: newObj.id }, { type: 'add', object: old }],
      };
    }

    case 'changeMaterial': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      const next = withObjects(scene.objects.map((o) => {
        if (o.id !== obj.id) return o;
        const { materialOverrides: _drop, ...rest } = o;
        return op.overrides ? { ...rest, materialOverrides: op.overrides } : rest;
      }));
      return {
        ok: true, scene: next, affected: [obj.id],
        inverse: [obj.materialOverrides
          ? { type: 'changeMaterial', objectId: obj.id, overrides: obj.materialOverrides }
          : { type: 'changeMaterial', objectId: obj.id }],
      };
    }

    case 'setLock': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      return {
        ok: true, affected: [obj.id],
        scene: withObjects(scene.objects.map((o) => (o.id === obj.id ? { ...o, locked: op.locked } : o))),
        inverse: [{ type: 'setLock', objectId: obj.id, locked: obj.locked }],
      };
    }

    case 'setPlacement': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      const pid = op.placement.parentId;
      if (pid !== undefined) {
        if (!index.has(pid)) return fail('INVALID_PARENT', 'Support object does not exist.', obj.id);
        if (wouldCycle(index, obj.id, pid)) return fail('INVALID_PARENT', 'An object cannot rest on itself or on something resting on it.', obj.id);
      }
      const next = withObjects(scene.objects.map((o) => (o.id === obj.id ? { ...o, placement: op.placement } : o)));
      const gErr = enforceGeometry(ctx, scene, next, [obj.id]);
      if (gErr) return gErr;
      const prev = obj.placement ?? { support: 'floor' as const };
      return { ok: true, scene: next, affected: [obj.id], inverse: [{ type: 'setPlacement', objectId: obj.id, placement: prev }] };
    }

    case 'resize': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      if (op.dimensionsM.some((d) => !(d > 0))) return fail('INVALID_DIMENSIONS', 'Dimensions must be positive.', obj.id);
      const next = withObjects(scene.objects.map((o) => (o.id === obj.id ? { ...o, dimensionsM: op.dimensionsM } : o)));
      const gErr = enforceGeometry(ctx, scene, next, [obj.id]);
      if (gErr) return gErr;
      return { ok: true, scene: next, affected: [obj.id], inverse: [{ type: 'resize', objectId: obj.id, dimensionsM: obj.dimensionsM }] };
    }

    case 'setTilt': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      if (obj.locked) return fail('LOCKED', `${obj.displayName} is locked.`, obj.id);
      const tErr = checkTilt(ctx, obj, op.tilt);
      if (tErr) return tErr;
      const next = withObjects(scene.objects.map((o) => {
        if (o.id !== obj.id) return o;
        const { tilt: _t, ...rest } = o;
        return op.tilt.x === 0 && op.tilt.z === 0 ? rest : { ...rest, tilt: op.tilt };
      }));
      const gErr = enforceGeometry(ctx, scene, next, [obj.id]);
      if (gErr) return gErr;
      return { ok: true, scene: next, affected: [obj.id], inverse: [{ type: 'setTilt', objectId: obj.id, tilt: obj.tilt ?? { x: 0, z: 0 } }] };
    }

    case 'setGroup': {
      const missing = op.objectIds.find((id) => !index.has(id));
      if (missing) return fail('NOT_FOUND', 'Object not found.', missing);
      const ids = new Set(op.objectIds);
      const next = withObjects(scene.objects.map((o) => {
        if (!ids.has(o.id)) return o;
        const { groupId: _g, ...rest } = o;
        return op.groupId ? { ...rest, groupId: op.groupId } : rest;
      }));
      // Inverse: restore each object's previous group (batched by previous value).
      const byPrev = new Map<string | null, string[]>();
      for (const id of op.objectIds) {
        const g = index.get(id)!.groupId ?? null;
        byPrev.set(g, [...(byPrev.get(g) ?? []), id]);
      }
      return {
        ok: true, scene: next, affected: op.objectIds,
        inverse: [...byPrev].map(([g, objectIds]) => ({ type: 'setGroup', objectIds, groupId: g }) as SceneOp),
      };
    }

    case 'setLight': {
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      return {
        ok: true, affected: [obj.id],
        scene: withObjects(scene.objects.map((o) => (o.id === obj.id ? { ...o, lightOn: op.on } : o))),
        inverse: [{ type: 'setLight', objectId: obj.id, on: obj.lightOn ?? true }],
      };
    }

    case 'setSceneSettings': {
      const next: SceneSpec = {
        ...scene,
        ...(op.lightingPreset !== undefined ? { lightingPreset: op.lightingPreset } : {}),
        ...(op.appearance !== undefined ? { appearance: op.appearance } : {}),
      };
      return {
        ok: true, scene: next, affected: [],
        inverse: [{
          type: 'setSceneSettings',
          ...(op.lightingPreset !== undefined ? { lightingPreset: scene.lightingPreset } : {}),
          ...(op.appearance !== undefined ? { appearance: scene.appearance ?? {} } : {}),
        }],
      };
    }

    case 'setRenovationDecision': {
      // Planning flag — allowed on locked objects (PRD §11: lock is orthogonal to Keep/Replace/Remove).
      const obj = index.get(op.objectId);
      if (!obj) return fail('NOT_FOUND', 'Object not found.', op.objectId);
      return {
        ok: true, affected: [obj.id],
        scene: withObjects(scene.objects.map((o) => {
          if (o.id !== obj.id) return o;
          const { renovationDecision: _drop, ...rest } = o;
          return op.decision ? { ...rest, renovationDecision: op.decision } : rest;
        })),
        inverse: [{ type: 'setRenovationDecision', objectId: obj.id, decision: obj.renovationDecision ?? null }],
      };
    }
  }
}

/**
 * Apply ops all-or-nothing. The returned inverse undoes the whole batch (reverse order).
 */
export function applyOps(ctx: OpContext, scene: SceneSpec, ops: readonly SceneOp[]): OpResult {
  let cur = scene;
  const inverses: SceneOp[][] = [];
  const affected = new Set<string>();
  for (let i = 0; i < ops.length; i++) {
    const r = applyOp(ctx, cur, ops[i]!);
    if (!r.ok) return { ok: false, error: { ...r.error, opIndex: i } };
    cur = r.scene;
    inverses.push(r.inverse);
    r.affected.forEach((id) => affected.add(id));
  }
  return { ok: true, scene: cur, inverse: inverses.reverse().flat(), affected: [...affected] };
}

/** Validate a SceneObject payload against the contract schema (for imports and fixtures). */
export function parseSceneObject(o: unknown): SceneObject {
  return SceneObjectSchema.parse(o);
}
