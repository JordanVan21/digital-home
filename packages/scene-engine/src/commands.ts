import type { AssetSpec, RenovationDecision, SceneObject, SceneOp, SceneSpec, Transform, Vec3 } from '@house/contracts';
import { placementClassOf, supportForClass } from './config';
import { makeTransform, yawFromQuat } from './math';
import { descendantsOf } from './ops';

/**
 * Editor-level command builders. Each returns contract `SceneOp`s; nothing here mutates state.
 * The sandbox's names map onto contract ops (SANDBOX_NOTES C17):
 * moveObject/rotateObject → move, removeObject → delete, setAsset → replaceAsset,
 * setLocked → setLock, setOwnership → setRenovationDecision (CONTRACT-TBD), duplicateObject → add×n.
 */

const find = (scene: SceneSpec, id: string) => scene.objects.find((o) => o.id === id);

export function moveObject(objectId: string, transform: Transform): SceneOp[] {
  return [{ type: 'move', objectId, transform }];
}

export function moveObjectTo(scene: SceneSpec, objectId: string, position: Vec3): SceneOp[] {
  const obj = find(scene, objectId);
  if (!obj) return [];
  return moveObject(objectId, { ...obj.transform, position: [...position] as Vec3 });
}

export function rotateObject(scene: SceneSpec, objectId: string, yaw: number): SceneOp[] {
  const obj = find(scene, objectId);
  if (!obj) return [];
  return moveObject(objectId, makeTransform(obj.transform.position, yaw));
}

export const removeObject = (objectId: string): SceneOp[] => [{ type: 'delete', objectId }];
export const setLocked = (objectId: string, locked: boolean): SceneOp[] => [{ type: 'setLock', objectId, locked }];
export const setOwnership = (objectId: string, decision: RenovationDecision | null): SceneOp[] =>
  [{ type: 'setRenovationDecision', objectId, decision }];
export const setAsset = (objectId: string, assetId: string | null, dimensionsM: Vec3): SceneOp[] =>
  [{ type: 'replaceAsset', objectId, assetId, dimensionsM }];
export const addObject = (object: SceneObject): SceneOp[] => [{ type: 'add', object }];

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** New catalog-sourced object for an asset, at `position` (base-center), facing `yaw`. */
export function objectFromAsset(
  asset: AssetSpec, id: string, position: Vec3, yaw = 0, parentId?: string,
): SceneObject {
  const cls = placementClassOf({ category: asset.category, placement: parentId ? { support: 'object', parentId } : undefined }, asset);
  return {
    id,
    assetId: asset.id,
    category: asset.category,
    transform: makeTransform(position, yaw),
    dimensionsM: [...asset.dimensionsM] as Vec3,
    locked: false,
    source: 'catalog',
    displayName: asset.title || titleCase(asset.category),
    placement: parentId ? { support: 'object', parentId } : { support: supportForClass(cls) },
  };
}

/**
 * Duplicate an object and its descendants with fresh ids, offset by `delta` (world XZ, m).
 * Copies are unlocked user objects; physical lineage fields are not copied.
 */
export function duplicateObject(
  scene: SceneSpec, objectId: string, newId: () => string, delta: [number, number],
): { ops: SceneOp[]; rootId: string } | null {
  const root = find(scene, objectId);
  if (!root) return null;
  const all = [root, ...descendantsOf(scene.objects, root.id)];
  const idMap = new Map(all.map((o) => [o.id, newId()]));
  const ops: SceneOp[] = all.map((o) => {
    const { replacesObjectId: _r, scanMatch: _s, ownership: _o, renovationDecision: _d, ...rest } = o;
    const parentId = o.placement?.parentId;
    const copy: SceneObject = {
      ...rest,
      id: idMap.get(o.id)!,
      locked: false,
      source: 'user',
      transform: {
        ...o.transform,
        position: [o.transform.position[0] + delta[0], o.transform.position[1], o.transform.position[2] + delta[1]],
      },
      ...(o.placement ? { placement: { ...o.placement, ...(parentId && idMap.has(parentId) ? { parentId: idMap.get(parentId)! } : {}) } } : {}),
    };
    return { type: 'add', object: copy };
  });
  return { ops, rootId: idMap.get(root.id)! };
}

export function yawOfObject(obj: SceneObject): number {
  return yawFromQuat(obj.transform.rotation);
}
