import { AssetRequest, type AssetSpec, type SceneObject, type SceneOp } from "@house/contracts";
import type { RenderOutcome } from "./service";

/** Request for a scene object that has no asset yet (scanned or planned). */
export function requestForObject(
  object: Pick<SceneObject, "category" | "displayName" | "dimensionsM">,
  extra: Partial<Pick<AssetRequest, "styles" | "colors" | "materials" | "allowGeneration">> = {}
): AssetRequest {
  return AssetRequest.parse({
    schemaVersion: 1,
    category: object.category,
    description: object.displayName,
    targetDimensionsM: object.dimensionsM,
    ...extra,
  });
}

/** Uniform fit exactly as the renderer applies it, so collision bounds equal what is drawn. */
export function fittedDimensions(asset: Pick<AssetSpec, "dimensionsM">, target: [number, number, number]): [number, number, number] {
  const scale = Math.min(...target.map((t, i) => t / asset.dimensionsM[i]));
  return asset.dimensionsM.map((n) => n * scale) as [number, number, number];
}

/**
 * `replaceAsset` ops (same object id, new visual). Objects keep their UUID because
 * only the visual changes. Outcomes without an asset, and locked objects, are
 * skipped. These ops still go through the scene engine's validator before being applied.
 */
export function toReplaceAssetOps(
  objects: Pick<SceneObject, "id" | "dimensionsM" | "locked">[],
  outcomes: Pick<RenderOutcome, "asset">[]
): SceneOp[] {
  const ops: SceneOp[] = [];
  objects.forEach((object, i) => {
    const outcome = outcomes[i];
    // CONTRACTS.md §4: locked objects cannot be replaced or recolored.
    if (!outcome?.asset || object.locked) return;
    ops.push({ type: "replaceAsset", objectId: object.id, assetId: outcome.asset.id, dimensionsM: fittedDimensions(outcome.asset, object.dimensionsM) });
  });
  return ops;
}
