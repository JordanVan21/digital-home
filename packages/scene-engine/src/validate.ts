import type { RoomShell, SceneObject, SceneOp, SceneSpec } from "@house/contracts";
import { isFiniteQuat, isFiniteVec3 } from "./geometry";
import {
  checkDoorwayKeepOut,
  checkFloorContainment,
  checkObjectOverlap,
  checkWallClearance,
  footprintOBB,
  isFloorSupported,
} from "./collision";
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

/**
 * Full placement check for a floor-supported object's candidate footprint:
 * inside the floor polygon, clear of wall thickness, clear of doorway
 * swing zones, and not overlapping another floor object (modulo the
 * semantic exemptions in collision.ts). Non-floor placements (wall/object
 * mounted) are exempt entirely. See CONTRACTS.md §4.
 */
function checkPlacement(
  shell: RoomShell,
  candidate: Pick<SceneObject, "transform" | "dimensionsM" | "category" | "placement">,
  othersExcludingSelf: SceneObject[]
): string | null {
  if (!isFloorSupported(candidate)) return null;

  const obb = footprintOBB(candidate.transform.position, candidate.transform.rotation, candidate.dimensionsM);

  if (!checkFloorContainment(shell, obb)) return "object placed outside room floor";

  const blockedByWall = checkWallClearance(shell, obb);
  if (blockedByWall) return "object overlaps wall thickness";

  const blockedByDoorway = checkDoorwayKeepOut(shell, obb);
  if (blockedByDoorway) return "object blocks a doorway";

  const blockedBy = checkObjectOverlap({ obb, category: candidate.category }, othersExcludingSelf);
  if (blockedBy) return `object overlaps ${blockedBy.displayName}`;

  return null;
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
      const placementError = checkPlacement(shell, op.object, scene.objects);
      if (placementError) return fail(placementError);
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
      const others = scene.objects.filter((o) => o.id !== op.objectId);
      const placementError = checkPlacement(shell, { ...target, transform: op.transform }, others);
      if (placementError) return fail(placementError);
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
      // A visual-model swap can change footprint size; re-check placement
      // against the new dimensions with the object's own transform.
      const others = scene.objects.filter((o) => o.id !== op.objectId);
      const placementError = checkPlacement(
        shell,
        { ...target, dimensionsM: op.dimensionsM },
        others
      );
      if (placementError) return fail(placementError);
      return ok();
    }
    case "replacePhysicalItem": {
      const target = findObject(scene, op.oldObjectId);
      if (!target) return fail(`object ${op.oldObjectId} not found`);
      if (target.locked) return fail(`object ${op.oldObjectId} is locked`);
      if (findObject(scene, op.newObject.id)) return fail(`duplicate object id ${op.newObject.id}`);
      if (!isWellFormedTransform(op.newObject)) return fail("invalid transform or dimensions");
      const others = scene.objects.filter((o) => o.id !== op.oldObjectId);
      const placementError = checkPlacement(shell, op.newObject, others);
      if (placementError) return fail(placementError);
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
