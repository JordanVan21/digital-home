/**
 * Renders library thumbnails from the models with real materials in GPU Chrome.
 * Needs a running dev server (default http://127.0.0.1:5173, or HOUSE_DEV_URL)
 * and HOUSE_BROWSER_EXECUTABLE pointing at Chrome.
 *
 *   node scripts/render-thumbnails.mjs [assetId ...]
 *
 * With no IDs it renders every self-authored asset, whose source branch only
 * shipped colour-swatch placeholders.
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HOUSE_DEV_URL ?? "http://127.0.0.1:5173";
const catalog = JSON.parse(
  await fs.readFile(
    path.join(root, "packages/contracts/src/catalog.json"),
    "utf8",
  ),
);
const ids = process.argv.slice(2);
const targets = ids.length
  ? catalog.filter((a) => ids.includes(a.id))
  : catalog.filter((a) => a.source === "self_authored");
const browser = await chromium.launch({
  executablePath: process.env.HOUSE_BROWSER_EXECUTABLE,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
for (const asset of targets) {
  await page.goto(`${base}/?thumbnail-studio=${asset.id}`);
  await page.waitForFunction(() => globalThis.__thumbnailReady === true, null, {
    timeout: 30000,
  });
  const png = await page.locator("canvas").screenshot();
  await sharp(png)
    .webp({ quality: 86 })
    .toFile(path.join(root, "apps/web/public", asset.thumbnailStorageKey));
  console.log(`${asset.title}: ${asset.thumbnailStorageKey}`);
}
await browser.close();
