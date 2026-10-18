import { AssetSpecSchema, catalog, type AssetSpec } from "@house/contracts";

export type CatalogConfig = { supabaseUrl?: string; supabaseAnonKey?: string };
export type CatalogSnapshot = {
  assets: AssetSpec[];
  source: "shared" | "bundled";
};
export interface PlannerCatalogSource {
  list(): Promise<CatalogSnapshot>;
}

/** Shared catalog metadata only. GLBs are fetched by the existing browser renderer. */
export function createCatalogSource(
  config: CatalogConfig,
  fetcher: typeof fetch = fetch,
): PlannerCatalogSource {
  let cached: Promise<CatalogSnapshot> | undefined;
  let expires = 0;
  return {
    list() {
      if (cached && Date.now() < expires) return cached;
      expires = Date.now() + 30_000;
      cached = (async (): Promise<CatalogSnapshot> => {
        if (!config.supabaseUrl || !config.supabaseAnonKey)
          return { assets: [...catalog], source: "bundled" };
        try {
          const response = await fetcher(
            `${config.supabaseUrl}/rest/v1/assets?select=spec,glb_path,thumbnail_path&order=id&limit=1000`,
            {
              headers: {
                apikey: config.supabaseAnonKey,
                Authorization: `Bearer ${config.supabaseAnonKey}`,
              },
              signal: AbortSignal.timeout(8_000),
            },
          );
          if (!response.ok) throw new Error("Catalog unavailable");
          const rows: unknown = await response.json();
          if (!Array.isArray(rows)) throw new Error("Invalid catalog");
          const assets = new Map(catalog.map((a) => [a.id, a]));
          for (const row of rows) {
            if (!row || typeof row !== "object") continue;
            const record = row as {
              spec?: unknown;
              glb_path?: unknown;
              thumbnail_path?: unknown;
            };
            if (
              !record.spec ||
              typeof record.spec !== "object" ||
              typeof record.glb_path !== "string"
            )
              continue;
            const path = record.glb_path.replace(/^\/+/, "");
            if (
              !path ||
              path
                .split("/")
                .some((segment) => segment === ".." || segment === ".")
            )
              continue;
            const glb = `${config.supabaseUrl}/storage/v1/object/public/glbs/${path.split("/").map(encodeURIComponent).join("/")}`;
            const asset = AssetSpecSchema.safeParse({
              ...record.spec,
              glbStorageKey: glb,
            });
            if (asset.success && asset.data.licenseStatus === "verified") {
              // Bundled models keep their local URLs; newly shared models use the public bucket.
              if (!assets.has(asset.data.id))
                assets.set(asset.data.id, asset.data);
            }
          }
          return { assets: [...assets.values()], source: "shared" };
        } catch {
          return { assets: [...catalog], source: "bundled" };
        }
      })();
      return cached;
    },
  };
}
