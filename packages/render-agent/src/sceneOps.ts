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
 * `replaceAsset` ops (same object id, new visual) for outcomes that found an
 * asset. Objects keep their UUID because only the visual changes. Outcomes
 * without an asset are skipped: those objects stay as placeholders.
 */
export function toReplaceAssetOps(
  objects: Pick<SceneObject, "id" | "dimensionsM">[],
  outcomes: Pick<RenderOutcome, "asset">[]
): SceneOp[] {
  const ops: SceneOp[] = [];
  objects.forEach((object, i) => {
    const asset = outcomes[i]?.asset;
    if (asset) ops.push({ type: "replaceAsset", objectId: object.id, assetId: asset.id, dimensionsM: fittedDimensions(asset, object.dimensionsM) });
  });
  return ops;
}
