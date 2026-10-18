import type { AssetSpec, RoomPlanCategory, ScanObject, SceneObject, Vec3 } from '@house/contracts';
import { ROOMPLAN_CATEGORY_MAP, placementClassOf, supportForClass } from './config';
import { makeTransform, yawFromQuat, normalizeAngle } from './math';

export type MatchOptions = {
  /** Mean relative dimension error above which the object becomes a placeholder. */
  maxError: number;
  /** Error penalty for a 90°-rotated (w/d swapped) match, so unswapped fits win ties. */
  swapPenalty: number;
  categoryMap: Readonly<Record<RoomPlanCategory, readonly string[]>>;
};

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  maxError: 0.35,
  swapPenalty: 0.02,
  categoryMap: ROOMPLAN_CATEGORY_MAP,
};

export type FitResult = { error: number; swapped: boolean };

/**
 * Footprint/height fit: mean relative error of w, d, h vs target ([w,h,d] vectors).
 * w/d may swap (asset rotated 90°), with a small penalty.
 */
export function dimensionFit(asset: Vec3, target: Vec3, swapPenalty = DEFAULT_MATCH_OPTIONS.swapPenalty): FitResult {
  const rel = (a: number, t: number) => Math.abs(a - t) / Math.max(t, 1e-6);
  const [aw, ah, ad] = asset;
  const [tw, th, td] = target;
  const straight = (rel(aw, tw) + rel(ad, td) + rel(ah, th)) / 3;
  const swapped = (rel(ad, tw) + rel(aw, td) + rel(ah, th)) / 3 + swapPenalty;
  return swapped < straight ? { error: swapped, swapped: true } : { error: straight, swapped: false };
}

export type RankedAsset = { asset: AssetSpec; error: number; swapped: boolean; score: number };

/** Eligible (license-verified) assets in `categories`, ranked by fit; deterministic tie-break on id. */
export function rankByDimensionFit(
  catalog: readonly AssetSpec[], categories: readonly string[], target: Vec3, swapPenalty = DEFAULT_MATCH_OPTIONS.swapPenalty,
): RankedAsset[] {
  return catalog
    .filter((a) => categories.includes(a.category) && a.licenseStatus === 'verified')
    .map((asset) => {
      const fit = dimensionFit(asset.dimensionsM, target, swapPenalty);
      return { asset, ...fit, score: Math.max(0, 1 - fit.error) };
    })
    .sort((a, b) => a.error - b.error || (a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0));
}

export type ScanMatchResult = {
  assetId: string | null;
  /** Catalog category the object gets (matched asset's, else the category map's first entry). */
  category: string;
  score: number;
  /** World size [w,h,d] for the object (the scan box; axes swapped when the asset is turned 90°). */
  dimensionsM: Vec3;
  /** Added to the scan yaw when the matched asset fits rotated 90°. */
  yawAdjust: number;
};

/** Match one scanned RoomPlan object to the best catalog asset, or a placeholder. Deterministic. */
export function matchScanObject(
  scan: Pick<ScanObject, 'category' | 'dimensionsM'>, catalog: readonly AssetSpec[], opts: Partial<MatchOptions> = {},
): ScanMatchResult {
  const o = { ...DEFAULT_MATCH_OPTIONS, ...opts };
  const categories = o.categoryMap[scan.category] ?? [];
  const fallbackCategory = categories[0] ?? scan.category;
  const best = rankByDimensionFit(catalog, categories, scan.dimensionsM, o.swapPenalty)[0];
  if (!best || best.error > o.maxError) {
    const score = best ? best.score : 0;
    return { assetId: null, category: fallbackCategory, score, dimensionsM: [...scan.dimensionsM] as Vec3, yawAdjust: 0 };
  }
  const [w, h, d] = scan.dimensionsM;
  return {
    assetId: best.asset.id,
    category: best.asset.category,
    score: best.score,
    dimensionsM: best.swapped ? [d, h, w] : [w, h, d],
    yawAdjust: best.swapped ? Math.PI / 2 : 0,
  };
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());

/** Build the SceneObject reproducing a scanned object. Its id is the scan object's id (stable). */
export function reproduceScanObject(
  scan: ScanObject, catalog: readonly AssetSpec[], opts: Partial<MatchOptions> = {},
): SceneObject {
  const m = matchScanObject(scan, catalog, opts);
  const asset = m.assetId ? catalog.find((a) => a.id === m.assetId) : undefined;
  const yaw = normalizeAngle(yawFromQuat(scan.transform.rotation) + m.yawAdjust);
  const base = { category: m.category, placement: undefined } as const;
  const cls = placementClassOf(base, asset);
  return {
    id: scan.scanObjectId,
    assetId: m.assetId,
    category: m.category,
    transform: m.yawAdjust === 0 ? { ...scan.transform, scale: [1, 1, 1] } : makeTransform(scan.transform.position, yaw),
    dimensionsM: m.dimensionsM,
    locked: false,
    source: 'roomplan_approximation',
    displayName: asset ? asset.title : `Approximate ${titleCase(m.category).toLowerCase()}`,
    ownership: 'existing',
    placement: { support: supportForClass(cls === 'surface' ? 'floor' : cls) },
    scanMatch: { roomPlanCategory: scan.category, scanDimensionsM: scan.dimensionsM, score: Number(m.score.toFixed(4)) },
  };
}
