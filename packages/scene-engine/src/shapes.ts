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

// ---------------------------------------------------------------- exposed top faces (from codex contactFaces.ts)

/** A top face patch in normalized model bounds: rect = [x0, z0, x1, z1], y = height (0..1). */
export type ShapeFace = { rect: [number, number, number, number]; y: number };

const EPS = 1e-7;
const faceCache = new WeakMap<readonly ShapeBox[], ShapeFace[]>();

/** `rect` minus `cut` (both [x0, z0, x1, z1]) as up to four rectangles. */
function subtract(rect: ShapeFace['rect'], cut: ShapeFace['rect']): ShapeFace['rect'][] {
  const [x0, z0, x1, z1] = rect;
  const a = Math.max(x0, cut[0]);
  const b = Math.max(z0, cut[1]);
  const c = Math.min(x1, cut[2]);
  const d = Math.min(z1, cut[3]);
  if (c - a <= EPS || d - b <= EPS) return [rect];
  return ([[x0, z0, a, z1], [c, z0, x1, z1], [a, z0, c, b], [a, d, c, z1]] as ShapeFace['rect'][])
    .filter(([x, z, u, v]) => u - x > EPS && v - z > EPS);
}

/**
 * Exposed top faces of a baked shape: each box's top, minus the columns of any box that continues
 * above it (so a chair seat under its backrest only keeps the open part, and the hidden top of an
 * internal block is not a surface). Cached per shape.
 */
export function exposedTopFaces(boxes: readonly ShapeBox[]): ShapeFace[] {
  const cached = faceCache.get(boxes);
  if (cached) return cached;
  const faces: ShapeFace[] = [];
  for (const [min, max] of boxes) {
    let patches: ShapeFace['rect'][] = [[min[0], min[2], max[0], max[2]]];
    for (const [low, high] of boxes) {
      if (low[1] > max[1] + EPS || high[1] <= max[1] + EPS) continue;
      patches = patches.flatMap((r) => subtract(r, [low[0], low[2], high[0], high[2]]));
      if (!patches.length) break;
    }
    faces.push(...patches.map((rect) => ({ rect, y: max[1] })));
  }
  faceCache.set(boxes, faces);
  return faces;
}
