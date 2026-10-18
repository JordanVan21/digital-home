import type { AssetSpec } from "@house/contracts";

/** Short credit for where a catalog model comes from. */
export function providerLabel(asset: AssetSpec): string {
  if (asset.sourceUrl?.startsWith("https://polyhaven.com/"))
    return "Poly Haven · CC0";
  if (asset.source === "furnimesh") return "FurniMesh";
  if (asset.source === "self_authored") return "House original · CC0";
  return asset.attribution ?? "Licensed model";
}
