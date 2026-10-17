import type { RoomShell, SceneObject, SceneOp, SceneSpec } from "@house/contracts";
import { isFiniteQuat, isFiniteVec3, pointInPolygonXZ } from "./geometry";
import { applyOp } from "./reduce";

export type ValidationResult = { valid: boolean; errors: string[] };

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}
function fail(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

function findObject(scene: SceneSpec, objectId: string): SceneObject | undefined {
  return scene.objects.find((o) => o.id === objectId);
}

function isWellFormedTransform(object: Pick<SceneObject, "transform" | "dimensionsM">): boolean {
  return (
    isFiniteVec3(object.transform.position) &&
    isFiniteQuat(object.transform.rotation) &&
    isFiniteVec3(object.transform.scale) &&
    object.transform.scale.every((s) => s > 0) &&
    isFiniteVec3(object.dimensionsM) &&
    object.dimensionsM.every((d) => d > 0)
  );
}

/** Ground-contact objects must sit inside the room's floor polygon. See CONTRACTS.md §4. */
function isWithinFloorBounds(shell: RoomShell, object: SceneObject): boolean {
  if (object.placement && object.placement.support !== "floor") return true;
  const [x, , z] = object.transform.position;
  return pointInPolygonXZ([x, z], shell.floor.polygonXZ);
}

export interface ValidateOpOptions {
  /** Known/approved asset IDs, e.g. from the catalog. Omit to skip asset existence checks. */
  isKnownAssetId?: (assetId: string) => boolean;
}

/**
 * Validates a single SceneOp against the current scene + shell. Pure and
 * deterministic; the same function backs client-side UX checks and
 * server-side authoritative validation (CONTRACTS.md §4).
 */
export function validateOp(
  scene: SceneSpec,
  shell: RoomShell,
  op: SceneOp,
  options: ValidateOpOptions = {}
): ValidationResult {
  switch (op.type) {
    case "add": {
      if (findObject(scene, op.object.id)) return fail(`duplicate object id ${op.object.id}`);
      if (!isWellFormedTransform(op.object)) return fail("invalid transform or dimensions");
      if (op.object.assetId && options.isKnownAssetId && !options.isKnownAssetId(op.object.assetId)) {
        return fail(`unknown asset id ${op.object.assetId}`);
      }
      if (!isWithinFloorBounds(shell, op.object)) return fail("object placed outside room floor");
      return ok();
    }
    case "delete": {
      const target = findObject(scene, op.objectId);
      if (!target) return fail(`object ${op.objectId} not found`);
      if (target.locked) return fail(`object ${op.objectId} is locked`);
      return ok();
    }
    case "move": {
      const target = findObject(scene, op.objectId);
      if (!target) return fail(`object ${op.objectId} not found`);
      if (target.locked) return fail(`object ${op.objectId} is locked`);
      if (!isWellFormedTransform({ transform: op.transform, dimensionsM: target.dimensionsM })) {
        return fail("invalid transform");
      }
      if (!isWithinFloorBounds(shell, { ...target, transform: op.transform })) {
        return fail("move places object outside room floor");
      }
      return ok();
    }
    case "replaceAsset": {
      const target = findObject(scene, op.objectId);
      if (!target) return fail(`object ${op.objectId} not found`);
      if (target.locked) return fail(`object ${op.objectId} is locked`);
      if (options.isKnownAssetId && !options.isKnownAssetId(op.assetId)) {
        return fail(`unknown asset id ${op.assetId}`);
      }
      if (!isFiniteVec3(op.dimensionsM) || !op.dimensionsM.every((d) => d > 0)) {
        return fail("invalid dimensions");
      }
      return ok();
    }
    case "replacePhysicalItem": {
      const target = findObject(scene, op.oldObjectId);
      if (!target) return fail(`object ${op.oldObjectId} not found`);
      if (target.locked) return fail(`object ${op.oldObjectId} is locked`);
      if (findObject(scene, op.newObject.id)) return fail(`duplicate object id ${op.newObject.id}`);
      if (!isWellFormedTransform(op.newObject)) return fail("invalid transform or dimensions");
      if (!isWithinFloorBounds(shell, op.newObject)) return fail("object placed outside room floor");
      return ok();
    }
    case "changeMaterial": {
      const target = findObject(scene, op.objectId);
      if (!target) return fail(`object ${op.objectId} not found`);
      if (target.locked) return fail(`object ${op.objectId} is locked`);
      return ok();
    }
    case "setLock": {
      // Locking/unlocking is the one mutation locked objects never block,
      // and the only op the agent tool allowlist excludes (CONTRACTS.md §4).
      const target = findObject(scene, op.objectId);
      if (!target) return fail(`object ${op.objectId} not found`);
      return ok();
    }
  }
}

export function validatePatch(
  scene: SceneSpec,
  shell: RoomShell,
  operations: SceneOp[],
  options: ValidateOpOptions = {}
): { valid: boolean; errors: { index: number; message: string }[] } {
  const errors: { index: number; message: string }[] = [];
  let working = scene;
  operations.forEach((op, index) => {
    const result = validateOp(working, shell, op, options);
    if (!result.valid) {
      errors.push(...result.errors.map((message) => ({ index, message })));
      return;
    }
    working = applyOp(working, op);
  });
  return { valid: errors.length === 0, errors };
}
