import type { AssetSpec, Vec3 } from "@house/contracts";

/** Match the render module's lower scale bound. An envelope is a maximum, not an exact shape. */
export function fitModelToEnvelope(
  asset: AssetSpec,
  maximum: Vec3,
): Vec3 | null {
  const scale = Math.min(1, ...maximum.map((n, i) => n / asset.dimensionsM[i]));
  if (!Number.isFinite(scale) || scale < 0.5) return null;
  return asset.dimensionsM.map((n) => n * scale) as Vec3;
}
