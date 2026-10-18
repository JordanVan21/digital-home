import { canSupport, supportCycle, topY, withContactSupport } from "./support";
import {
  SceneObjectSchema,
  SceneOpSchema,
  type AssetSpec,
  type RoomShell,
  type SceneObject,
  type SceneOp,
  type SceneSpec,
} from "@house/contracts";
import {
  doorClearances,
  footprint,
  insidePolygon,
  overlaps,
  wallFootprints,
} from "./geometry";
export type ErrorCode =
  | "OBJECT_LOCKED"
  | "OUT_OF_BOUNDS"
  | "COLLISION"
  | "BLOCKS_OPENING"
  | "UNKNOWN_OBJECT"
  | "UNKNOWN_ASSET"
  | "DUPLICATE_ID"
  | "INVALID_TRANSFORM"
  | "ROOM_MISMATCH"
  | "INVALID_SUPPORT";
export type ValidationError = {
  code: ErrorCode;
  message: string;
  objectId?: string;
};
export type Validation = { ok: true } | { ok: false; error: ValidationError };
export interface SceneContext {
  room: RoomShell;
  assets: Readonly<Record<string, AssetSpec>>;
  roomId?: string;
}
const fail = (
  code: ErrorCode,
  message: string,
  objectId?: string,
): Validation => ({ ok: false, error: { code, message, objectId } });
// Explicit semantic rules. These exemptions apply ONLY to floor occupancy, not bounds or doorway clearance.
export const occupancyRules = {
  underlayCategories: ["rug"],
  nonFloorSupports: ["wall", "object"],
} as const;
function occupiesFloor(o: SceneObject): boolean {
  return (
    !occupancyRules.underlayCategories.some((c) => c === o.category) &&
    !occupancyRules.nonFloorSupports.some((s) => s === o.placement?.support)
  );
}
/**
 * Draft edits pass `allowConflicts` to skip only the checks a later resolve can
 * fix by moving or settling the piece (bounds, wall band, doorway, overlaps,
 * surface contact). Locks, identity, asset, upright rotation and support-reference
 * rules always apply.
 */
export type ValidationOptions = { allowConflicts?: boolean };
export function validateObject(
  scene: SceneSpec,
  o: SceneObject,
  ctx: SceneContext,
  options: ValidationOptions = {},
): Validation {
  if (!SceneObjectSchema.safeParse(o).success)
    return fail(
      "INVALID_TRANSFORM",
      "Use a valid position, rotation, and size.",
    );
  if (
    o.assetId &&
    (!ctx.assets[o.assetId] ||
      ctx.assets[o.assetId].licenseStatus !== "verified")
  )
    return fail("UNKNOWN_ASSET", "This asset is unavailable.");
  const support = o.placement?.support ?? "floor";
  if (supportCycle(scene, o))
    return fail("INVALID_SUPPORT", "Support cannot form a cycle.");
  if (
    support === "object" &&
    (!o.placement?.parentId ||
      !scene.objects.some(
        (p) => p.id === o.placement?.parentId && p.id !== o.id,
      ))
  )
    return fail("INVALID_SUPPORT", "Choose an existing supporting object.");
  if (
    support === "wall" &&
    !ctx.room.walls.some((w) => w.id === o.placement?.parentId)
  )
    return fail("INVALID_SUPPORT", "Choose a supporting wall.");
  // Keep yaw-only footprints; elevation is a fixable draft conflict.
  if (
    support !== "wall" &&
    (Math.abs(o.transform.rotation[0]) > 1e-6 ||
      Math.abs(o.transform.rotation[2]) > 1e-6)
  )
    return fail("INVALID_TRANSFORM", "Keep furniture upright.");
  if (options.allowConflicts) return { ok: true };
  if (
    support === "floor" &&
    Math.abs(o.transform.position[1] - ctx.room.floor.elevationY) > 1e-5
  )
    return fail(
      "INVALID_SUPPORT",
      "Accept will settle this piece onto the nearest floor or furniture surface.",
    );
  if (support === "object") {
    const parent = scene.objects.find((p) => p.id === o.placement?.parentId)!;
    if (
      !canSupport(parent, o) ||
      Math.abs(o.transform.position[1] - topY(parent)) > 1e-5
    )
      return fail(
        "INVALID_SUPPORT",
        "Place the bottom center on its supporting surface.",
      );
  }
  if (
    o.transform.position[1] < ctx.room.floor.elevationY - 1e-5 ||
    (ctx.room.ceilingHeightM !== undefined &&
      topY(o) > ctx.room.floor.elevationY + ctx.room.ceilingHeightM + 1e-5)
  )
    return fail("OUT_OF_BOUNDS", "Keep the piece between floor and ceiling.");
  const rect = footprint(o);
  if (!insidePolygon(rect, ctx.room.floor.polygonXZ))
    return fail("OUT_OF_BOUNDS", "Keep the whole object inside the room.");
  if (
    support !== "wall" &&
    wallFootprints(ctx.room).some((w) => overlaps(rect, w))
  )
    return fail("OUT_OF_BOUNDS", "Leave a little space from the wall.");
  if (
    support !== "wall" &&
    doorClearances(ctx.room).some((d) => overlaps(rect, d))
  )
    return fail("BLOCKS_OPENING", "Leave the doorway clear.");
  if (occupiesFloor(o) || support === "object")
    for (const other of scene.objects) {
      if (
        other.id !== o.id &&
        (occupiesFloor(other) || other.placement?.support === "object") &&
        Math.min(topY(o), topY(other)) -
          Math.max(o.transform.position[1], other.transform.position[1]) >
          1e-7 &&
        overlaps(rect, footprint(other))
      )
        return fail(
          "COLLISION",
          `Would collide with ${other.displayName}.`,
          other.id,
        );
    }
  return { ok: true };
}
export function validateOp(
  scene: SceneSpec,
  op: SceneOp,
  ctx: SceneContext,
  options: ValidationOptions = {},
): Validation {
  if (
    scene.shellId !== ctx.room.id ||
    (ctx.roomId && ctx.roomId !== scene.roomId)
  )
    return fail("ROOM_MISMATCH", "This edit belongs to another room.");
  if (!SceneOpSchema.safeParse(op).success)
    return fail(
      "INVALID_TRANSFORM",
      "Use a valid position, rotation, and size.",
    );
  if (op.type === "add") {
    if (scene.objects.some((o) => o.id === op.object.id))
      return fail("DUPLICATE_ID", "This object is already in the room.");
    return validateObject(scene, op.object, ctx, options);
  }
  const id = op.type === "replacePhysicalItem" ? op.oldObjectId : op.objectId;
  const obj = scene.objects.find((o) => o.id === id);
  if (!obj)
    return fail("UNKNOWN_OBJECT", "This object is no longer in the room.");
  if (op.type === "setLock") return { ok: true };
  if (obj.locked)
    return fail(
      "OBJECT_LOCKED",
      `${obj.displayName} is locked. Unlock it first.`,
      obj.id,
    );
  if (op.type === "delete" || op.type === "replacePhysicalItem") {
    if (scene.objects.some((o) => o.placement?.parentId === id))
      return fail("INVALID_SUPPORT", "Move supported objects first.");
  }
  if (op.type === "delete") return { ok: true };
  if (op.type === "changeMaterial") return { ok: true };
  if (op.type === "replacePhysicalItem") {
    if (scene.objects.some((o) => o.id === op.newObject.id))
      return fail("DUPLICATE_ID", "A replacement needs a new identity.");
    return validateObject(
      { ...scene, objects: scene.objects.filter((o) => o.id !== id) },
      { ...op.newObject, replacesObjectId: id },
      ctx,
      options,
    );
  }
  const next =
    op.type === "move"
      ? withContactSupport(scene, { ...obj, transform: op.transform }, ctx.room)
      : { ...obj, assetId: op.assetId, dimensionsM: op.dimensionsM };
  const validation = validateObject(scene, next, ctx, options);
  if (!validation.ok || options.allowConflicts) return validation;
  const candidateScene = {
    ...scene,
    objects: scene.objects.map((o) => (o.id === id ? next : o)),
  };
  for (const child of candidateScene.objects.filter(
    (o) => o.placement?.parentId === id,
  )) {
    const supported = validateObject(candidateScene, child, ctx);
    if (!supported.ok)
      return fail(
        "INVALID_SUPPORT",
        "Move supported objects together as suggestions first.",
        child.id,
      );
  }
  return validation;
}
export type ApplyResult =
  | { ok: true; scene: SceneSpec }
  | { ok: false; error: ValidationError };
export function applyOp(
  scene: SceneSpec,
  op: SceneOp,
  ctx: SceneContext,
  options: ValidationOptions = {},
): ApplyResult {
  const valid = validateOp(scene, op, ctx, options);
  if (!valid.ok) return valid;
  let objects: SceneObject[];
  if (op.type === "add")
    objects = [...scene.objects, structuredClone(op.object)];
  else if (op.type === "delete")
    objects = scene.objects.filter((o) => o.id !== op.objectId);
  else if (op.type === "replacePhysicalItem")
    objects = scene.objects.map((o) =>
      o.id === op.oldObjectId
        ? { ...structuredClone(op.newObject), replacesObjectId: op.oldObjectId }
        : o,
    );
  else
    objects = scene.objects.map((o) => {
      if (o.id !== op.objectId) return o;
      switch (op.type) {
        case "move":
          return withContactSupport(
            scene,
            { ...o, transform: structuredClone(op.transform) },
            ctx.room,
          );
        case "replaceAsset":
          return {
            ...o,
            assetId: op.assetId,
            dimensionsM: [...op.dimensionsM],
          };
        case "changeMaterial": {
          const next = { ...o };
          if (op.overrides === undefined) delete next.materialOverrides;
          else next.materialOverrides = structuredClone(op.overrides);
          return next;
        }
        case "setLock":
          return { ...o, locked: op.locked };
      }
    });
  // A pure reducer must not read the wall clock. The persistence adapter stamps real save time.
  return {
    ok: true,
    scene: { ...scene, objects, revision: scene.revision + 1 },
  };
}
/** Internal history checkpoints cover changes the public op union cannot losslessly invert (notably null assets). */
export type Checkpoint = { type: "checkpoint"; scene: SceneSpec };
export type Inverse = SceneOp | Checkpoint;
export function invertOp(before: SceneSpec, op: SceneOp): Inverse {
  if (op.type === "add") return { type: "delete", objectId: op.object.id };
  const id = op.type === "replacePhysicalItem" ? op.oldObjectId : op.objectId;
  const obj = before.objects.find((o) => o.id === id);
  if (!obj) throw new Error("Cannot invert an unknown object");
  switch (op.type) {
    case "delete":
      return { type: "add", object: structuredClone(obj) };
    case "move":
      return {
        type: "move",
        objectId: id,
        transform: structuredClone(obj.transform),
      };
    case "setLock":
      return { type: "setLock", objectId: id, locked: obj.locked };
    case "changeMaterial":
      return {
        type: "changeMaterial",
        objectId: id,
        overrides: structuredClone(obj.materialOverrides),
      };
    case "replaceAsset":
      return obj.assetId
        ? {
            type: "replaceAsset",
            objectId: id,
            assetId: obj.assetId,
            dimensionsM: [...obj.dimensionsM],
          }
        : { type: "checkpoint", scene: structuredClone(before) };
    case "replacePhysicalItem":
      return { type: "checkpoint", scene: structuredClone(before) };
  }
}
