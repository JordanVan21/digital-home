#!/usr/bin/env node
// Seed the Supabase asset library (assets table + public glbs bucket) from the
// sandbox's catalog and its models/thumbnails. Idempotent: re-running upserts.
//
//   node --env-file=.env scripts/seed-assets.mjs [git-ref]
//
// Default source is the codex-base sandbox: catalog at
// packages/contracts/src/catalog.json (an AssetSpec array), files under
// apps/web/public/<glbStorageKey>. Also accepts the older layout
// (apps/web/public/catalog/catalog.json = {assets: [...]}). Files are read with
// `git show <ref>:...`, so the source branch is never checked out.
// Bucket paths drop the leading "/" (e.g. models/sofa.glb). Needs SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY.
import { execFileSync } from "node:child_process";

const ref = process.argv[2] ?? "origin/feature/3d-sandbox-codex-base";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env).");

const auth = { apikey: key, Authorization: `Bearer ${key}` };
const git = (path) => execFileSync("git", ["show", `${ref}:${path}`], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (path) => { try { return git(path); } catch { return null; } };
const codexCatalog = tryGit("packages/contracts/src/catalog.json");
const publicRoot = codexCatalog ? "apps/web/public" : "apps/web/public/catalog";
const catalogJson = JSON.parse((codexCatalog ?? git(`${publicRoot}/catalog.json`)).toString("utf8"));
const assets = Array.isArray(catalogJson) ? catalogJson : catalogJson.assets;
const bucketPath = (key) => key.replace(/^\/+/, "");
const show = (key) => git(`${publicRoot}/${bucketPath(key)}`);
const mime = (path) =>
  path.endsWith(".glb") ? "model/gltf-binary"
  : path.endsWith(".webp") ? "image/webp"
  : path.endsWith(".png") ? "image/png" : "image/jpeg";

// Supabase closes idle keep-alive connections; Node's fetch can reuse one that is
// already closed ("other side closed"). Retry those on a fresh connection.
async function upload(key) {
  const path = bucketPath(key);
  const body = show(key);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}/storage/v1/object/glbs/${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": mime(path), "x-upsert": "true", "Cache-Control": "31536000" },
        body,
      });
      if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
      return;
    } catch (error) {
      // TypeError = network drop (EPIPE, "other side closed"): back off and retry.
      if (attempt >= 8 || !(error instanceof TypeError)) throw error;
      console.log(`\n  retry ${attempt} ${path}: ${error.cause?.code ?? error.message}`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
    }
  }
}

const rows = [];
const failed = [];
for (const spec of assets) {
  try {
    await upload(spec.glbStorageKey);
    if (spec.thumbnailStorageKey) await upload(spec.thumbnailStorageKey);
  } catch (error) {
    // Skip this asset (no row) and keep going; rerun the script to retry it.
    failed.push(`${spec.title} (${spec.glbStorageKey}): ${error.cause?.code ?? error.message}`);
    process.stdout.write("x");
    continue;
  }
  const [width, height, depth] = spec.dimensionsM; // width, height, depth
  rows.push({
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
  });
  process.stdout.write(".");
}

const res = await fetch(`${url}/rest/v1/assets`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
if (!res.ok) throw new Error(`assets upsert: ${res.status} ${await res.text()}`);
console.log(`\nSeeded ${rows.length} assets from ${ref}. Public GLB base: ${url}/storage/v1/object/public/glbs/`);
if (failed.length) {
  console.log(`\n${failed.length} asset(s) skipped after retries (rerun to try again):`);
  for (const line of failed) console.log(`  - ${line}`);
  process.exitCode = 1;
}
