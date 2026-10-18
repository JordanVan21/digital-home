import { describe, expect, it } from "vitest";
import {
  AssetSpecSchema,
  FloorPlanSchema,
  RoomShellSchema,
  SceneObjectSchema,
  SceneOpSchema,
  SceneSpecSchema,
  TransformSchema,
} from "./schemas";
import { catalog, fixtureScene, roomShell } from "./fixtures";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
describe("normative fixtures", () => {
  it("parses the shell, complete scene, every object and every catalog asset", () => {
    expect(RoomShellSchema.parse(roomShell)).toEqual(roomShell);
    expect(SceneSpecSchema.parse(fixtureScene)).toEqual(fixtureScene);
    fixtureScene.objects.forEach((o) =>
      expect(SceneObjectSchema.parse(o)).toEqual(o),
    );
    catalog.forEach((a) => expect(AssetSpecSchema.parse(a)).toEqual(a));
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    expect(fixtureScene.objects.some((o) => o.assetId === null)).toBe(true);
    expect(
      fixtureScene.objects.find((o) => o.category === "desk")?.locked,
    ).toBe(true);
  });
  it("ships real local GLBs, thumbnails and license coverage", () => {
    const licenses = readFileSync("apps/web/public/models/LICENSES.md", "utf8");
    for (const a of catalog) {
      const file = resolve("apps/web/public", a.glbStorageKey.slice(1));
      expect(readFileSync(file).subarray(0, 4).toString()).toBe("glTF");
      expect(licenses).toContain(a.glbStorageKey.split("/").at(-1));
      expect(
        existsSync(resolve("apps/web/public", a.thumbnailStorageKey!.slice(1))),
      ).toBe(true);
    }
    const triangles = fixtureScene.objects.reduce(
      (n, o) =>
        n + (catalog.find((a) => a.id === o.assetId)?.triangleCount ?? 12),
      0,
    );
    expect(triangles).toBeLessThan(500_000);
  });
  it("includes self-hosted Poly Haven models with provenance and browser budgets", () => {
    const imported = catalog.filter(
      (a) =>
        a.sourceUrl?.startsWith("https://polyhaven.com/") &&
        !a.id.startsWith("a55e7000-"),
    );
    // 3 curated imports plus the batch import (scripts/polyhaven-batch-2.json).
    expect(imported.length).toBeGreaterThanOrEqual(3);
    expect(new Set(imported.map((a) => a.id)).size).toBe(imported.length);
    for (const asset of imported) {
      expect(asset.licenseStatus).toBe("verified");
      expect(asset.attribution).toContain("CC0");
      // The importer simplifies toward 25k; the simplifier lands within a few percent.
      expect(asset.triangleCount).toBeLessThanOrEqual(27000);
      // Real-scale furniture: large sofas and dining tables exceed 2 m.
      expect(asset.dimensionsM.every((n) => n > 0 && n < 3)).toBe(true);
    }
  });
  it("includes Jordan's catalog with CC0 provenance and unique IDs", () => {
    const licenses = readFileSync("apps/web/public/models/LICENSES.md", "utf8");
    const jordan = catalog.filter((a) => a.id.startsWith("a55e7000-"));
    expect(jordan).toHaveLength(39);
    expect(new Set(catalog.map((a) => a.id)).size).toBe(catalog.length);
    expect(new Set(catalog.map((a) => a.glbStorageKey)).size).toBe(
      catalog.length,
    );
    for (const a of jordan) {
      expect(a.licenseStatus).toBe("verified");
      expect(a.attribution).toContain("CC0");
      expect(licenses).toContain(`| ${a.glbStorageKey.split("/").at(-1)} |`);
      expect(a.category).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
  it("rejects bad transforms and structural geometry", () => {
    expect(
      TransformSchema.safeParse({
        position: [0, 0, 0],
        rotation: [0, 0, 0, 2],
        scale: [1, 1, 1],
      }).success,
    ).toBe(false);
    expect(
      TransformSchema.safeParse({
        position: [Infinity, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 0, 1],
      }).success,
    ).toBe(false);
    expect(
      FloorPlanSchema.safeParse({
        polygonXZ: [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
        ],
        elevationY: 0,
      }).success,
    ).toBe(false);
    expect(
      RoomShellSchema.safeParse({
        ...roomShell,
        openings: [{ ...roomShell.openings[0], offsetM: 100 }],
      }).success,
    ).toBe(false);
    expect(
      SceneOpSchema.safeParse({
        type: "move",
        objectId: "not-uuid",
        transform: fixtureScene.objects[0].transform,
      }).success,
    ).toBe(false);
  });
});
