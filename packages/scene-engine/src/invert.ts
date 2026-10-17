import type { SceneOp, SceneSpec } from "@house/contracts";

/**
 * Computes the inverse of a SceneOp given the scene state *before* it was
 * applied, for the editor's local undo stack (CONTRACTS.md §3.5). This is a
 * client-only convenience — undo/redo is editor history, never persisted as
 * the renovation timeline.
 */
export function invertOp(sceneBefore: SceneSpec, op: SceneOp): SceneOp | null {
  switch (op.type) {
    case "add":
      return { type: "delete", objectId: op.object.id };

    case "delete": {
      const prior = sceneBefore.objects.find((o) => o.id === op.objectId);
      return prior ? { type: "add", object: prior } : null;
    }

    case "move": {
      const prior = sceneBefore.objects.find((o) => o.id === op.objectId);
      return prior ? { type: "move", objectId: op.objectId, transform: prior.transform } : null;
    }

    case "replaceAsset": {
      const prior = sceneBefore.objects.find((o) => o.id === op.objectId);
      return prior && prior.assetId
        ? {
            type: "replaceAsset",
            objectId: op.objectId,
            assetId: prior.assetId,
            dimensionsM: prior.dimensionsM,
          }
        : null;
    }

    case "replacePhysicalItem": {
      const prior = sceneBefore.objects.find((o) => o.id === op.oldObjectId);
      return prior
        ? { type: "replacePhysicalItem", oldObjectId: op.newObject.id, newObject: prior }
        : null;
    }

    case "changeMaterial": {
      const prior = sceneBefore.objects.find((o) => o.id === op.objectId);
      return prior
        ? {
            type: "changeMaterial",
            objectId: op.objectId,
            overrides: prior.materialOverrides ?? {},
          }
        : null;
    }

    case "setLock": {
      const prior = sceneBefore.objects.find((o) => o.id === op.objectId);
      return prior ? { type: "setLock", objectId: op.objectId, locked: prior.locked } : null;
    }
  }
}
