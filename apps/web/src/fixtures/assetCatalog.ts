import { AssetSpec } from "@house/contracts";
import records from "./assetCatalog.json";

/** Local stand-in for the approved catalog API. IDs and URLs are immutable. */
export const assetCatalog = records.map((record) => AssetSpec.parse(record));
const byId = new Map(assetCatalog.map((asset) => [asset.id, asset]));
export function resolveAsset(id: string | null): AssetSpec | undefined {
  const asset = id ? byId.get(id) : undefined;
  return asset?.licenseStatus === "verified" ? asset : undefined;
}
export function fixtureAsset(category: string): AssetSpec | undefined {
  return assetCatalog.find((asset) => asset.category === category && asset.licenseStatus === "verified");
}
