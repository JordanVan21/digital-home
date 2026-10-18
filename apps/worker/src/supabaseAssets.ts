import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAssetRegistry,
  type AssetRegistry,
  type GlbStore,
  type RegisterInput,
  type RegisterResult,
} from "@house/asset-service";
import type { AssetSpec } from "@house/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Bucket paths never start with "/" (catalog keys like "/models/sofa.glb" do). */
export const bucketPath = (key: string) => key.replace(/^\/+/, "");

/** Row for the assets table: the AssetSpec as-is plus search projections. */
export function assetRow(spec: AssetSpec & { estimatedPrice?: { minor: number; currency: string } }) {
  const [width, height, depth] = spec.dimensionsM;
  return {
    id: spec.id,
    spec,
    category: spec.category,
    title: spec.title,
    width_m: width,
    height_m: height,
    depth_m: depth,
    tags: spec.tags ?? [],
    styles: spec.styles ?? [],
    glb_path: bucketPath(spec.glbStorageKey),
    thumbnail_path: spec.thumbnailStorageKey ? bucketPath(spec.thumbnailStorageKey) : null,
    price_minor: spec.estimatedPrice?.minor ?? null,
    currency: spec.estimatedPrice?.currency ?? null,
  };
}

/** The shared library, read fresh per job so newly generated assets are visible. */
export async function loadCatalog(db: SupabaseClient): Promise<AssetSpec[]> {
  const { data, error } = await db.from("assets").select("spec");
  if (error) throw new Error(`Could not read assets: ${error.message}`);
  return data.map((row) => row.spec as AssetSpec);
}

/** Reads library GLBs from the glbs bucket (render agent modify/measure path). */
export class SupabaseGlbStore implements GlbStore {
  constructor(private readonly db: SupabaseClient) {}
  async readGlb(storageKey: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from("glbs").download(bucketPath(storageKey));
    if (error || !data) throw new Error(`GLB not found: ${storageKey}`);
    return new Uint8Array(await data.arrayBuffer());
  }
}

/**
 * Validation/normalization stays in FileAssetRegistry (a local work directory);
 * every validated GLB is then published to the glbs bucket and the assets table.
 */
export class SupabaseAssetRegistry implements AssetRegistry {
  private readonly local: FileAssetRegistry;
  constructor(private readonly db: SupabaseClient, private readonly workDir: string) {
    this.local = new FileAssetRegistry({ publicRoot: workDir });
  }

  list() {
    return this.local.list();
  }

  async registerGenerated(input: RegisterInput): Promise<RegisterResult> {
    const result = await this.local.registerGenerated(input);
    if (!result.ok) return result;
    const key = bucketPath(result.asset.glbStorageKey);
    const bytes = await readFile(join(this.workDir, key));
    const upload = await this.db.storage
      .from("glbs")
      .upload(key, bytes, { contentType: "model/gltf-binary", upsert: true });
    if (upload.error) return { ok: false, errors: [`Upload failed: ${upload.error.message}`], warnings: result.warnings };
    const { error } = await this.db.from("assets").upsert(assetRow(result.asset));
    if (error) return { ok: false, errors: [`Asset row failed: ${error.message}`], warnings: result.warnings };
    return result;
  }
}
