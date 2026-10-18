import { describe, expect, it } from "vitest";
import type { AssetSpec, ScanObject, Vec3 } from "@house/contracts";
import { fixtureId } from "@house/contracts";
import {
  matchScanObject,
  rankByDimensionFit,
  reproduceScanObject,
  type MatchOptions,
} from "./matching";
import { yawOf } from "./geometry";

const asset = (
  id: string,
  category: string,
  dimensionsM: Vec3,
  licenseStatus: AssetSpec["licenseStatus"] = "verified",
): AssetSpec => ({
  schemaVersion: 1,
  id,
  category,
  title: id,
  tags: [],
  styles: [],
  colors: [],
  materials: [],
  dimensionsM,
  glbStorageKey: `/models/${id}.glb`,
  source: "other",
  licenseStatus,
  contentHash: id,
  searchableDescription: id,
});
// Jordan's matching cases, with categories in this catalog's vocabulary.
const catalog = [
  asset("sofa-small", "sofa", [1.6, 0.8, 0.85]),
  asset("sofa-large", "sofa", [2.1, 0.85, 0.95]),
  asset("sofa-restricted", "sofa", [1.96, 0.82, 0.93], "restricted"),
  asset("sofa-pending", "sofa", [1.96, 0.82, 0.93], "pending"),
  asset("armchair", "armchair", [0.8, 0.8, 0.6]),
  asset("chair-side", "chair", [0.45, 0.9, 0.5]),
  asset("coffee", "coffee-table", [1.0, 0.42, 0.55]),
  asset("desk", "desk", [1.2, 0.75, 0.6]),
  asset("shelf", "bookshelf", [0.8, 1.8, 0.35]),
  asset("twin-b", "side-table", [0.5, 0.55, 0.5]),
  asset("twin-a", "side-table", [0.5, 0.55, 0.5]),
];
type Case = {
  name: string;
  scan: Pick<ScanObject, "category" | "dimensionsM">;
  options?: Partial<MatchOptions>;
  expect: {
    assetId: string | null;
    yawAdjustDeg?: number;
    dimensionsM?: Vec3;
    category?: string;
    score?: number;
  };
};
const cases: Case[] = [
  {
    name: "sofa picks the closest size",
    scan: { category: "sofa", dimensionsM: [2, 0.84, 0.92] },
    expect: {
      assetId: "sofa-large",
      yawAdjustDeg: 0,
      dimensionsM: [2, 0.84, 0.92],
    },
  },
  {
    name: "restricted and pending assets are never matched even with an exact fit",
    scan: { category: "sofa", dimensionsM: [1.96, 0.82, 0.93] },
    expect: { assetId: "sofa-large", yawAdjustDeg: 0 },
  },
  {
    name: "low table becomes a coffee table",
    scan: { category: "table", dimensionsM: [0.98, 0.43, 0.57] },
    expect: { assetId: "coffee", yawAdjustDeg: 0 },
  },
  {
    name: "desk-height table becomes a desk",
    scan: { category: "table", dimensionsM: [1.18, 0.76, 0.62] },
    expect: { assetId: "desk", yawAdjustDeg: 0 },
  },
  {
    name: "w/d swapped scan matches via a 90° yaw adjustment",
    scan: { category: "chair", dimensionsM: [0.6, 0.8, 0.8] },
    expect: {
      assetId: "armchair",
      yawAdjustDeg: 90,
      dimensionsM: [0.8, 0.8, 0.6],
    },
  },
  {
    name: "storage with no good fit becomes a placeholder",
    scan: { category: "storage", dimensionsM: [0.9, 0.8, 0.45] },
    expect: { assetId: null, category: "storage" },
  },
  {
    name: "category with no catalog entries becomes a placeholder",
    scan: { category: "fireplace", dimensionsM: [1.2, 1.1, 0.4] },
    expect: { assetId: null, category: "fireplace", score: 0 },
  },
  {
    name: "identical fits break ties by asset id",
    scan: { category: "table", dimensionsM: [0.5, 0.55, 0.5] },
    expect: { assetId: "twin-a" },
  },
  {
    name: "a stricter threshold turns a loose fit into a placeholder",
    scan: { category: "sofa", dimensionsM: [1.8, 0.8, 0.9] },
    options: { maxError: 0.05 },
    expect: { assetId: null, category: "sofa" },
  },
];

describe("matchScanObject", () => {
  for (const c of cases)
    it(c.name, () => {
      const m = matchScanObject(c.scan, catalog, c.options);
      expect(m.assetId).toBe(c.expect.assetId);
      if (c.expect.yawAdjustDeg !== undefined)
        expect((m.yawAdjust * 180) / Math.PI).toBeCloseTo(
          c.expect.yawAdjustDeg,
        );
      if (c.expect.dimensionsM)
        expect(m.dimensionsM).toEqual(c.expect.dimensionsM);
      if (c.expect.category) expect(m.category).toBe(c.expect.category);
      if (c.expect.score !== undefined) expect(m.score).toBe(c.expect.score);
      // Deterministic, independent of catalog order.
      expect(
        matchScanObject(c.scan, [...catalog].reverse(), c.options),
      ).toEqual(m);
    });
  it("prefers a placeholder over a model that would render badly stretched", () => {
    // 0.9 m wide storage against a 1.65 m sideboard: about 31% mean error.
    const sideboard = asset("sideboard", "sideboard", [1.65, 0.78, 0.42]);
    const m = matchScanObject(
      { category: "storage", dimensionsM: [0.9, 0.8, 0.45] },
      [sideboard],
    );
    expect(m.assetId).toBeNull();
    expect(m.category).toBe("storage");
  });
  it("ranks only verified assets in the requested categories", () => {
    const ranked = rankByDimensionFit(catalog, ["sofa"], [1.96, 0.82, 0.93]);
    expect(ranked.map((r) => r.asset.id)).toEqual(["sofa-large", "sofa-small"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe("reproduceScanObject", () => {
  const scan = (
    category: ScanObject["category"],
    dimensionsM: Vec3,
    yaw = 0.4,
  ): ScanObject => ({
    scanObjectId: fixtureId(800),
    category,
    dimensionsM,
    transform: {
      position: [0.5, 0, -0.3],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      scale: [1, 1, 1],
    },
  });
  it("keeps the scan id, position, yaw and size and records provenance", () => {
    const o = reproduceScanObject(scan("sofa", [2, 0.84, 0.92]), catalog);
    expect(o.id).toBe(fixtureId(800));
    expect(o.assetId).toBe("sofa-large");
    expect(o.transform.position).toEqual([0.5, 0, -0.3]);
    expect(yawOf(o.transform.rotation)).toBeCloseTo(0.4);
    expect(o.dimensionsM).toEqual([2, 0.84, 0.92]);
    expect(o.source).toBe("roomplan_approximation");
    expect(o.ownership).toBe("existing");
    expect(o.placement).toEqual({ support: "floor" });
    expect(o.scanMatch).toMatchObject({
      roomPlanCategory: "sofa",
      scanDimensionsM: [2, 0.84, 0.92],
    });
  });
  it("turns a swapped match 90° and names placeholders by category", () => {
    const turned = reproduceScanObject(
      scan("chair", [0.6, 0.8, 0.8], 0),
      catalog,
    );
    expect(yawOf(turned.transform.rotation)).toBeCloseTo(Math.PI / 2);
    expect(turned.dimensionsM).toEqual([0.8, 0.8, 0.6]);
    const placeholder = reproduceScanObject(
      scan("fireplace", [1, 1.1, 0.4]),
      catalog,
    );
    expect(placeholder.assetId).toBeNull();
    expect(placeholder.displayName).toBe("Approximate fireplace");
  });
});
