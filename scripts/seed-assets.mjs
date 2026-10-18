#!/usr/bin/env node
// Seed the Supabase asset library (assets table + public glbs bucket) from a
// sandbox catalog.json and its models/thumbs. Idempotent: re-running upserts.
//
//   node --env-file=.env scripts/seed-assets.mjs [git-ref]
//
// Reads files with `git show <ref>:apps/web/public/catalog/...` so the source
// branch is never checked out. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
import { execFileSync } from "node:child_process";

const ref = process.argv[2] ?? "origin/feature/3d-sandbox-merge";
const base = "apps/web/public/catalog";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env).");

const auth = { apikey: key, Authorization: `Bearer ${key}` };
const show = (path) => execFileSync("git", ["show", `${ref}:${base}/${path}`], { maxBuffer: 1 << 28 });
const mime = (path) =>
  path.endsWith(".glb") ? "model/gltf-binary"
  : path.endsWith(".webp") ? "image/webp"
  : path.endsWith(".png") ? "image/png" : "image/jpeg";

async function upload(path) {
  const res = await fetch(`${url}/storage/v1/object/glbs/${path}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": mime(path), "x-upsert": "true", "Cache-Control": "31536000" },
    body: show(path),
  });
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
}

const { assets } = JSON.parse(show("catalog.json").toString("utf8"));
const rows = [];
for (const spec of assets) {
  await upload(spec.glbStorageKey);
  if (spec.thumbnailStorageKey) await upload(spec.thumbnailStorageKey);
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
    glb_path: spec.glbStorageKey,
    thumbnail_path: spec.thumbnailStorageKey ?? null,
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
