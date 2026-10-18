import type { AssetSpec, SceneObject, Vec3 } from '@house/contracts';
import profiles from './shapeProfiles.json';
import type { AssetLookup } from './body';

/**
 * Baked model shapes (from the codex sandbox; regenerate with `pnpm bake:shapes`). Each profile is a
 * list of boxes in the model's normalized bounds: x, z ∈ [0, 1] across width / depth, y ∈ [0, 1] up
 * the height. They describe what a model *looks like* — used for selection outlines and for finding
 * real top faces (seats, shelves). Collision never reads them; it stays on the category profiles in
 * body.ts. A profile is used only while its content hash matches the asset's GLB.
 */
export type ShapeBox = [Vec3, Vec3];
type Profile = { contentHash: string; boxes: ShapeBox[] };

const baked = profiles as unknown as Record<string, Profile>;

/** The asset's baked shape, or null (no asset, alpha-tested model, or stale profile). */
export function shapeOfAsset(asset: Pick<AssetSpec, 'id' | 'contentHash'> | undefined | null): ShapeBox[] | null {
  if (!asset) return null;
  const p = baked[asset.id];
  return p && p.contentHash === asset.contentHash ? p.boxes : null;
}

export function shapeOf(obj: Pick<SceneObject, 'assetId'>, assets?: AssetLookup): ShapeBox[] | null {
  return obj.assetId ? shapeOfAsset(assets?.(obj.assetId)) : null;
}

/** Ids with a baked profile (for tests / tooling). */
export const bakedShapeIds = (): string[] => Object.keys(baked);
export const bakedShapeHash = (id: string): string | undefined => baked[id]?.contentHash;
