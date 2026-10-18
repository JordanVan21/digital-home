/**
 * Imports the furniture catalog from Jordan's sandbox branch into this catalog.
 *
 * Reads straight from git (default ref origin/feature/3d-sandblox-jordan), so the
 * provenance is a commit rather than a local checkout. Models and thumbnails are
 * copied byte-for-byte; they are already bottom-centered, metre scale, +Z front
 * and meshopt compressed, the same convention as the rest of the catalog.
 * Re-running is idempotent. Afterwards run `pnpm geometry:bake` and
 * `pnpm assets:verify`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { codexCategory } from "./jordan-categories.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ref = process.argv[2] ?? "origin/feature/3d-sandblox-jordan";
const show = (file) =>
  execFileSync("git", ["show", `${ref}:${file}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
const commit = execFileSync("git", ["rev-parse", "--short", ref], { cwd: root })
  .toString()
  .trim();
const publicDir = path.join(root, "apps/web/public");
const catalogPath = path.join(root, "packages/contracts/src/catalog.json");

const source = JSON.parse(show("apps/web/public/catalog/catalog.json"));
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const kept = catalog.filter((a) => !a.id.startsWith("a55e7000-"));
const imported = [];
for (const a of source.assets) {
  const model = path.basename(a.glbStorageKey),
    thumb = path.basename(a.thumbnailStorageKey);
  const glb = show(`apps/web/public/catalog/${a.glbStorageKey}`);
  await fs.writeFile(path.join(publicDir, "models", model), glb);
  await fs.writeFile(
    path.join(publicDir, "thumbnails", thumb),
    show(`apps/web/public/catalog/${a.thumbnailStorageKey}`),
  );
  imported.push({
    schemaVersion: 1,
    id: a.id,
    category: codexCategory(a.category),
    title: a.title,
    tags: a.tags,
    styles: a.styles,
    colors: a.colors,
    materials: a.materials,
    dimensionsM: a.dimensionsM,
    glbStorageKey: `/models/${model}`,
    thumbnailStorageKey: `/thumbnails/${thumb}`,
    source: a.source,
    ...(a.sourceUrl ? { sourceUrl: a.sourceUrl } : {}),
    licenseStatus: a.licenseStatus,
    attribution: a.attribution,
    ...(a.estimatedPrice ? { estimatedPrice: a.estimatedPrice } : {}),
    triangleCount: a.triangleCount,
    textureBytes: a.textureBytes,
    contentHash: createHash("sha256").update(glb).digest("hex"),
    searchableDescription: a.searchableDescription,
    ...(a.light ? { light: a.light } : {}),
    ...(a.variants ? { variants: a.variants } : {}),
    ...(a.category === "pendant"
      ? { mount: "ceiling" }
      : a.category === "wall_art"
        ? { mount: "wall" }
        : {}),
  });
}
await fs.writeFile(
  catalogPath,
  JSON.stringify([...kept, ...imported], null, 2) + "\n",
);

// License table: one row per imported file, replacing any previous import section.
const licensesPath = path.join(publicDir, "models/LICENSES.md");
const heading = "## Jordan's sandbox catalog";
const licenses = (await fs.readFile(licensesPath, "utf8")).split(heading)[0];
const rows = source.assets.map((a) => {
  const link = a.sourceUrl
    ? `[Model page](${a.sourceUrl})`
    : "Generated in-repo";
  return `| ${path.basename(a.glbStorageKey)} | ${link} | ${a.attribution} | ${a.license ?? "CC0-1.0"} |`;
});
await fs.writeFile(
  licensesPath,
  `${licenses.trimEnd()}

${heading}

Imported from \`${ref}\` (commit \`${commit}\`) by \`scripts/import-jordan-catalog.mjs\`. Poly Haven models are CC0-1.0 ([license](https://polyhaven.com/license)); self-authored models were generated procedurally in that branch (\`tools/asset-ingest/procedural.mjs\`) and released CC0-1.0. Thumbnails were rendered from the models in that branch.

| File | Source | Attribution | License |
|---|---|---|---|
${rows.join("\n")}
`,
);
console.log(`Imported ${imported.length} assets from ${ref} (${commit}).`);
