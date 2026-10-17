import type { SceneOp, SceneSpec } from "@house/contracts";

/**
 * Pure state transition for one SceneOp. No validation here (see validate.ts) —
 * callers must validate before applying in any authoritative path. Shared by
 * the browser editor (immediate local commit) and the server (trusted patch
 * application). See SYSTEM_ARCHITECTURE.md §16.
 */
export function applyOp(scene: SceneSpec, op: SceneOp): SceneSpec {
  switch (op.type) {
    case "add":
      return { ...scene, objects: [...scene.objects, op.object] };

    case "delete":
      return { ...scene, objects: scene.objects.filter((o) => o.id !== op.objectId) };

    case "move":
      return {
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === op.objectId ? { ...o, transform: op.transform } : o
        ),
      };

    case "replaceAsset":
      return {
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === op.objectId
            ? { ...o, assetId: op.assetId, dimensionsM: op.dimensionsM }
            : o
        ),
      };

    case "replacePhysicalItem":
      return {
        ...scene,
        objects: scene.objects
          .filter((o) => o.id !== op.oldObjectId)
          .concat({ ...op.newObject, replacesObjectId: op.oldObjectId }),
      };

    case "changeMaterial":
      return {
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === op.objectId
            ? { ...o, materialOverrides: { ...o.materialOverrides, ...op.overrides } }
            : o
        ),
      };

    case "setLock":
      return {
        ...scene,
        objects: scene.objects.map((o) =>
          o.id === op.objectId ? { ...o, locked: op.locked } : o
        ),
      };
  }
}

export function applyPatch(scene: SceneSpec, operations: SceneOp[]): SceneSpec {
  return operations.reduce(applyOp, scene);
}
