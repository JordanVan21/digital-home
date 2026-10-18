import { AssetCatalogFileSchema, type AssetSpec } from '@house/contracts';

/**
 * Asset metadata + URL resolution. The local implementation reads /catalog/catalog.json and GLBs
 * from apps/web/public/catalog. A Supabase adapter can implement the same interface later
 * (pre-signing URLs in `load`, keyed by immutable asset id / content hash).
 */
export interface AssetCatalog {
  list(): readonly AssetSpec[];
  get(assetId: string): AssetSpec | undefined;
  /** GLB URL for an asset, or null if the asset is unknown. */
  resolveUrl(assetId: string): string | null;
  resolveThumbnailUrl(assetId: string): string | null;
}

export class LocalAssetCatalog implements AssetCatalog {
  private readonly byId: Map<string, AssetSpec>;

  constructor(private readonly assets: readonly AssetSpec[], private readonly baseUrl = '/catalog/') {
    this.byId = new Map(assets.map((a) => [a.id, a]));
  }

  static async load(baseUrl = '/catalog/', fetchImpl: typeof fetch = fetch): Promise<LocalAssetCatalog> {
    const res = await fetchImpl(`${baseUrl}catalog.json`);
    if (!res.ok) throw new Error(`Catalog load failed: ${res.status}`);
    const file = AssetCatalogFileSchema.parse(await res.json());
    return new LocalAssetCatalog(file.assets, baseUrl);
  }

  list() {
    return this.assets;
  }

  get(assetId: string) {
    return this.byId.get(assetId);
  }

  resolveUrl(assetId: string) {
    const a = this.byId.get(assetId);
    return a ? `${this.baseUrl}${a.glbStorageKey}` : null;
  }

  resolveThumbnailUrl(assetId: string) {
    const a = this.byId.get(assetId);
    return a?.thumbnailStorageKey ? `${this.baseUrl}${a.thumbnailStorageKey}` : null;
  }
}
