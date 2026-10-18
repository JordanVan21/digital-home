import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AssetRequest, AssetResolution, AssetSpec } from "@house/contracts";
import { categoryAffinity } from "./categories";
import { retrieveAsset, scoreAsset } from "./retrieve";
import { requestTokens, tokenCoverage } from "./text";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function asset(partial: Partial<AssetSpec> & Pick<AssetSpec, "category" | "dimensionsM">): AssetSpec {
  return AssetSpec.parse({
    schemaVersion: 1, id: uuid(), title: partial.category, tags: [], styles: [], colors: [], materials: [],
    glbStorageKey: "models/x.glb", source: "other", licenseStatus: "verified", contentHash: "h", searchableDescription: partial.category,
    ...partial,
  });
}
const req = (r: Partial<AssetRequest> & Pick<AssetRequest, "category" | "targetDimensionsM">) =>
  AssetRequest.parse({ schemaVersion: 1, ...r });

test("category affinity: exact, alias, and hard-incompatible", () => {
  assert.equal(categoryAffinity("sofa", "sofa"), 1);
  assert.equal(categoryAffinity("Coffee Table", "coffee_table"), 1);
  assert.ok(categoryAffinity("chair", "armchair") > 0 && categoryAffinity("chair", "armchair") < 1);
  assert.equal(categoryAffinity("sofa", "bed"), 0);
});

test("token coverage ignores plurals and filler", () => {
  assert.equal(tokenCoverage(requestTokens("wooden shelves", "bookshelf"), "Wooden Display Shelf CC0 Poly Haven"), 1);
  assert.equal(tokenCoverage(requestTokens("", "sofa"), "anything"), 0);
  // "arm chair" in the asset title satisfies "armchair" in the request, and category words are not scored twice.
  assert.equal(tokenCoverage(requestTokens("armchair", "sofa"), "Modern Arm Chair 01"), 1);
  assert.equal(requestTokens("accent armchair", "armchair").size, 1);
});

test("hard filters reject unverified, wrong category, bad scale and bad proportions", () => {
  const target: [number, number, number] = [2, 1, 1];
  const r = req({ category: "sofa", targetDimensionsM: target });
  const why = (a: AssetSpec) => { const x = scoreAsset(r, a); return "rejection" in x ? x.rejection.reason : "ok"; };
  assert.equal(why(asset({ category: "sofa", dimensionsM: [2, 1, 1], licenseStatus: "pending" })), "not_verified");
  assert.equal(why(asset({ category: "bed", dimensionsM: [2, 1, 1] })), "category_mismatch");
  assert.equal(why(asset({ category: "sofa", dimensionsM: [6, 3, 3] })), "scale_out_of_range"); // needs 1/3 shrink
  assert.equal(why(asset({ category: "sofa", dimensionsM: [2, 1, 1.9] })), "proportions_mismatch"); // in scale range, but depth fills ~53%
  assert.equal(why(asset({ category: "sofa", dimensionsM: [2.2, 1.1, 1.1] })), "ok");
});

test("size score reflects how tightly the scaled model fills the envelope", () => {
  const r = req({ category: "sofa", targetDimensionsM: [2, 1, 1] });
  const tight = scoreAsset(r, asset({ category: "sofa", dimensionsM: [2, 1, 1] }));
  const loose = scoreAsset(r, asset({ category: "sofa", dimensionsM: [2, 1, 1.8] }));
  assert.ok("candidate" in tight && "candidate" in loose);
  assert.ok(tight.candidate.breakdown.size > loose.candidate.breakdown.size);
});

test("unspecified components are excluded; unlabeled assets are 'unknown', not mismatches", () => {
  const unlabeled = asset({ category: "sofa", dimensionsM: [2, 1, 1] });
  const labeled = asset({ category: "sofa", dimensionsM: [2, 1, 1], styles: ["japandi"] });
  const noPref = scoreAsset(req({ category: "sofa", targetDimensionsM: [2, 1, 1] }), unlabeled);
  assert.ok("candidate" in noPref && noPref.candidate.breakdown.style === null && noPref.candidate.score === 1);
  const r = req({ category: "sofa", styles: ["japandi"], targetDimensionsM: [2, 1, 1] });
  const u = scoreAsset(r, unlabeled), l = scoreAsset(r, labeled);
  const mismatch = scoreAsset(r, asset({ category: "sofa", dimensionsM: [2, 1, 1], styles: ["industrial"] }));
  assert.ok("candidate" in u && "candidate" in l && "candidate" in mismatch);
  assert.ok(l.candidate.score > u.candidate.score && u.candidate.score > mismatch.candidate.score);
});

test("decision bands: matched, ambiguous, needs_generation, and empty catalog", () => {
  const catalog = [asset({ category: "sofa", dimensionsM: [2, 1, 1], styles: ["japandi"] })];
  const t: [number, number, number] = [2, 1, 1];
  assert.equal(retrieveAsset(req({ category: "sofa", styles: ["japandi"], targetDimensionsM: t }), catalog).resolution.status, "matched");
  assert.equal(retrieveAsset(req({ category: "sofa", styles: ["industrial"], targetDimensionsM: t }), catalog, { generateBelow: 0.3 }).resolution.status, "ambiguous");
  const low = retrieveAsset(req({ category: "sofa", styles: ["industrial"], colors: ["red"], targetDimensionsM: t }), catalog, { generateBelow: 0.9, acceptThreshold: 0.95 }).resolution;
  assert.equal(low.status, "needs_generation");
  const none = retrieveAsset(req({ category: "bed", targetDimensionsM: t }), catalog).resolution;
  assert.deepEqual(none.status === "needs_generation" && [none.reason, none.bestScore], ["no_eligible_asset", null]);
});

test("results are deterministic regardless of catalog order, and topK is honored", () => {
  const items = [1, 2, 3, 4].map((i) => asset({ category: "sofa", dimensionsM: [2, 1, 1 + i * 0.05] }));
  const r = req({ category: "sofa", targetDimensionsM: [2, 1, 1] });
  const a = retrieveAsset(r, items, { topK: 2 }).resolution;
  const b = retrieveAsset(r, [...items].reverse(), { topK: 2 }).resolution;
  assert.deepEqual(a, b);
  assert.ok(a.status !== "needs_generation" && a.candidates.length === 2);
});

test("every resolution validates against the contract schema", () => {
  const out = retrieveAsset(req({ category: "sofa", targetDimensionsM: [2, 1, 1] }), [asset({ category: "sofa", dimensionsM: [2, 1, 1] })]);
  AssetResolution.parse(out.resolution);
});

// --- Evaluation set against the real catalog. The thresholds are tuned here. ---
const catalog = (JSON.parse(readFileSync(new URL("../../../apps/web/src/fixtures/assetCatalog.json", import.meta.url), "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));
const cases = JSON.parse(readFileSync(new URL("./eval/requests.json", import.meta.url), "utf8")) as {
  name: string; request: Record<string, unknown>;
  expect: { status: string; category?: string; generationAllowed?: boolean };
}[];

for (const c of cases) {
  test(`eval: ${c.name}`, () => {
    const { resolution } = retrieveAsset(AssetRequest.parse({ schemaVersion: 1, ...c.request }), catalog);
    const detail = JSON.stringify(resolution, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
    assert.equal(resolution.status, c.expect.status, detail);
    if (c.expect.category && resolution.status !== "needs_generation") {
      assert.equal(catalog.find((a) => a.id === resolution.assetId)!.category, c.expect.category, detail);
    }
    if (c.expect.generationAllowed !== undefined && resolution.status === "needs_generation") {
      assert.equal(resolution.generationAllowed, c.expect.generationAllowed);
    }
  });
}
