import type {
  AssetSpec,
  RoomPlanCategory,
  ScanObject,
  SceneObject,
  Vec3,
} from "@house/contracts";
import { yawOf } from "./geometry";

/**
 * Scan reproduction: each RoomPlan object becomes the best-fitting verified
 * catalog asset, or a labelled placeholder, at the scanned pose. Pure and
 * deterministic; ported from Jordan's sandbox with this catalog's categories.
 */
export const roomPlanCategories: Readonly<
  Record<RoomPlanCategory, readonly string[]>
> = {
  storage: ["storage", "sideboard", "bookshelf"],
  refrigerator: ["refrigerator"],
  stove: ["stove"],
  bed: ["bed"],
  sink: ["sink"],
  washerDryer: ["washer-dryer"],
  toilet: ["toilet"],
  bathtub: ["bathtub"],
  oven: ["oven"],
  dishwasher: ["dishwasher"],
  table: ["table", "desk", "coffee-table", "side-table"],
  sofa: ["sofa"],
  chair: ["chair", "armchair"],
  fireplace: ["fireplace"],
  television: ["tv"],
  stairs: ["stairs"],
};

export type MatchOptions = {
  /** Mean relative dimension error above which the object becomes a placeholder. */
  maxError: number;
  /** Error added to a 90°-turned (width/depth swapped) fit, so straight fits win ties. */
  swapPenalty: number;
  categoryMap: Readonly<Record<RoomPlanCategory, readonly string[]>>;
};
export const defaultMatchOptions: MatchOptions = {
  // Models are fitted to the object's box, so a loose match renders visibly
  // stretched; past this error a labelled placeholder reads better.
  maxError: 0.25,
  swapPenalty: 0.02,
  categoryMap: roomPlanCategories,
};

/** Mean relative error of width, height and depth; width and depth may swap. */
export function dimensionFit(
  asset: Vec3,
  target: Vec3,
  swapPenalty = defaultMatchOptions.swapPenalty,
): { error: number; swapped: boolean } {
  const rel = (a: number, t: number) => Math.abs(a - t) / Math.max(t, 1e-6);
  const [aw, ah, ad] = asset,
    [tw, th, td] = target;
  const straight = (rel(aw, tw) + rel(ad, td) + rel(ah, th)) / 3;
  const swapped = (rel(ad, tw) + rel(aw, td) + rel(ah, th)) / 3 + swapPenalty;
  return swapped < straight
    ? { error: swapped, swapped: true }
    : { error: straight, swapped: false };
}

export type RankedAsset = {
  asset: AssetSpec;
  error: number;
  swapped: boolean;
  score: number;
};
/** Verified assets in `categories`, best fit first; ties break on asset ID. */
export function rankByDimensionFit(
  catalog: readonly AssetSpec[],
  categories: readonly string[],
  target: Vec3,
  swapPenalty = defaultMatchOptions.swapPenalty,
): RankedAsset[] {
  return catalog
    .filter(
      (a) => categories.includes(a.category) && a.licenseStatus === "verified",
    )
    .map((asset) => {
      const fit = dimensionFit(asset.dimensionsM, target, swapPenalty);
      return { asset, ...fit, score: Math.max(0, 1 - fit.error) };
    })
    .sort(
      (a, b) =>
        a.error - b.error ||
        (a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0),
    );
}

export type ScanMatchResult = {
  assetId: string | null;
  category: string;
  score: number;
  /** World size for the object: the scan box, with axes swapped for a turned match. */
  dimensionsM: Vec3;
  /** Added to the scan yaw when the asset fits turned 90°. */
  yawAdjust: number;
};
export function matchScanObject(
  scan: Pick<ScanObject, "category" | "dimensionsM">,
  catalog: readonly AssetSpec[],
  options: Partial<MatchOptions> = {},
): ScanMatchResult {
  const o = { ...defaultMatchOptions, ...options };
  const categories = o.categoryMap[scan.category] ?? [];
  const best = rankByDimensionFit(
    catalog,
    categories,
    scan.dimensionsM,
    o.swapPenalty,
  )[0];
  if (!best || best.error > o.maxError)
    return {
      assetId: null,
      category: categories[0] ?? scan.category,
      score: best ? best.score : 0,
      dimensionsM: [...scan.dimensionsM],
      yawAdjust: 0,
    };
  const [w, h, d] = scan.dimensionsM;
  return {
    assetId: best.asset.id,
    category: best.asset.category,
    score: best.score,
    dimensionsM: best.swapped ? [d, h, w] : [w, h, d],
    yawAdjust: best.swapped ? Math.PI / 2 : 0,
  };
}

/** The scene object reproducing one scanned object. It keeps the scan's stable ID. */
export function reproduceScanObject(
  scan: ScanObject,
  catalog: readonly AssetSpec[],
  options: Partial<MatchOptions> = {},
): SceneObject {
  const m = matchScanObject(scan, catalog, options);
  const asset = m.assetId ? catalog.find((a) => a.id === m.assetId) : undefined;
  const yaw = yawOf(scan.transform.rotation) + m.yawAdjust;
  return {
    id: scan.scanObjectId,
    assetId: m.assetId,
    category: m.category,
    transform: {
      position: [...scan.transform.position],
      rotation:
        m.yawAdjust === 0
          ? [...scan.transform.rotation]
          : [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      scale: [1, 1, 1],
    },
    dimensionsM: m.dimensionsM,
    locked: false,
    source: "roomplan_approximation",
    displayName: asset
      ? asset.title
      : `Approximate ${m.category.replaceAll("-", " ")}`,
    ownership: "existing",
    placement: { support: "floor" },
    scanMatch: {
      roomPlanCategory: scan.category,
      scanDimensionsM: [...scan.dimensionsM],
      score: Number(m.score.toFixed(4)),
    },
  };
}
