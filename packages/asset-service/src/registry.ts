import { mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AssetSpec, type AssetRequest } from "@house/contracts";
import { GlbError, inspectGlb, normalizeGlb } from "./glb";
import { DEFAULT_GLB_POLICY, validateGlb, type GlbPolicy } from "./validate";

export type RegisterInput = { glb: Uint8Array; request: AssetRequest; title: string; derivedFromAssetId?: string };
export type RegisterResult =
  | { ok: true; asset: AssetSpec; created: boolean; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** Library of generated assets. The only path to a verified generated asset runs through validation here. */
export interface AssetRegistry {
  list(): Promise<AssetSpec[]>;
  registerGenerated(input: RegisterInput): Promise<RegisterResult>;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "asset";
const normCategory = (c: string) => c.trim().toLowerCase().replace(/[\s-]+/g, "_");
/** Same convention as the Poly Haven fixtures: id = first 128 bits of the content hash. */
function uuidFromHash(hash: string): string {
  const h = hash.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type FileRegistryOptions = {
  /** Directory the web app serves at "/" (apps/web/public). */
  publicRoot: string;
  keyPrefix?: string;
  /** "pending" keeps validated assets out of rendering until a human promotes them. */
  status?: "verified" | "pending";
  policy?: GlbPolicy;
};

/**
 * Local stand-in for the Supabase assets table + storage bucket: GLBs under
 * <publicRoot>/<keyPrefix>/ and a catalog.json beside them. Content-addressed,
 * so registering the same model twice is a no-op that returns the same asset.
 */
export class FileAssetRegistry implements AssetRegistry {
  private readonly prefix: string;
  private readonly status: "verified" | "pending";
  private readonly policy: GlbPolicy;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: FileRegistryOptions) {
    this.prefix = options.keyPrefix ?? "models/generated";
    this.status = options.status ?? "verified";
    this.policy = options.policy ?? DEFAULT_GLB_POLICY;
  }

  get catalogPath() { return join(this.options.publicRoot, this.prefix, "catalog.json"); }

  async list(): Promise<AssetSpec[]> {
    try {
      const raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as unknown[];
      return raw.map((r) => AssetSpec.parse(r));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  registerGenerated(input: RegisterInput): Promise<RegisterResult> {
    // Serialize read-modify-write of catalog.json across concurrent jobs.
    const run = this.writing.then(() => this.register(input));
    this.writing = run.catch(() => undefined);
    return run;
  }

  private async register({ glb, request, title, derivedFromAssetId }: RegisterInput): Promise<RegisterResult> {
    let normalized: Uint8Array;
    try {
      normalized = normalizeGlb(glb, request.targetDimensionsM);
    } catch (error) {
      if (error instanceof GlbError) return { ok: false, errors: [error.message], warnings: [] };
      throw error;
    }
    const inspection = inspectGlb(normalized);
    const validation = validateGlb(inspection, request, this.policy);
    if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };

    const id = uuidFromHash(inspection.contentHash);
    const existing = (await this.list()).find((a) => a.id === id);
    if (existing) return { ok: true, asset: existing, created: false, warnings: validation.warnings };

    const key = `${this.prefix}/${slug(title)}-${inspection.contentHash.slice(0, 12)}.glb`;
    const file = join(this.options.publicRoot, key);
    await mkdir(dirname(file), { recursive: true });
    await atomicWrite(file, normalized);

    const labels = [...request.styles, ...request.colors, ...request.materials].join(" ");
    const asset = AssetSpec.parse({
      schemaVersion: 1,
      id,
      category: normCategory(request.category),
      title,
      tags: [derivedFromAssetId ? "modified" : "generated"],
      ...(derivedFromAssetId ? { derivedFromAssetId } : {}),
      styles: request.styles,
      colors: request.colors,
      materials: request.materials,
      dimensionsM: inspection.size,
      glbStorageKey: key,
      source: "generated",
      licenseStatus: this.status,
      attribution: "Generated for House with Blender",
      triangleCount: inspection.triangleCount,
      textureBytes: inspection.textureBytes,
      contentHash: inspection.contentHash,
      searchableDescription: [title, request.description, labels].filter(Boolean).join(". "),
    });
    const catalog = await this.list();
    await atomicWrite(this.catalogPath, new TextEncoder().encode(JSON.stringify([...catalog, asset], null, 2)));
    return { ok: true, asset, created: true, warnings: validation.warnings };
  }
}

/** Reads published GLBs by storage key (stand-in for a storage bucket download). */
export interface GlbStore {
  readGlb(storageKey: string): Promise<Uint8Array>;
}

export class FileGlbStore implements GlbStore {
  private readonly roots: string[];
  /** Roots are tried in order, so bundled assets and generated ones can live in different directories. */
  constructor(roots: string | string[]) { this.roots = Array.isArray(roots) ? roots : [roots]; }
  async readGlb(storageKey: string): Promise<Uint8Array> {
    // Storage keys are server-managed, but never trust one to stay inside a root.
    if (!/^[\w./-]+\.glb$/.test(storageKey) || storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key.");
    for (const root of this.roots) {
      try { return new Uint8Array(await readFile(join(root, storageKey))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw new Error(`GLB not found: ${storageKey}`);
  }
}

async function atomicWrite(path: string, data: Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
