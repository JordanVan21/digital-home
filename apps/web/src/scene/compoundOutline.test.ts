import { describe, expect, it } from "vitest";
import { assetById, catalog, createFixtureScene } from "@house/contracts";
import { colliderBlocks } from "@house/scene-engine";
import { compoundExteriorPositions } from "./compoundOutline";
const block = (min: number[], max: number[]) => [min, max];
describe("compound exterior outlines", () => {
  it("removes touching/overlapping box faces and collinear seams", () => {
    for (const boxes of [
      [block([0, 0, 0], [0.5, 1, 1]), block([0.5, 0, 0], [1, 1, 1])],
      [block([0, 0, 0], [0.7, 1, 1]), block([0.3, 0, 0], [1, 1, 1])],
    ]) {
      const positions = compoundExteriorPositions(boxes);
      expect(positions.length).toBe(12 * 6);
      expect(compoundExteriorPositions(boxes)).toBe(positions);
    }
  });
  it("draws an L-shaped exterior without an enclosing cube or internal box edges", () => {
    const positions = compoundExteriorPositions([
      block([0, 0, 0], [1, 1, 0.5]),
      block([0, 0, 0.5], [0.5, 1, 1]),
    ]);
    expect(positions.length).toBe(18 * 6);
    for (let i = 0; i < positions.length; i += 3)
      expect(positions[i] > 0.5 && positions[i + 2] > 0.5).toBe(false);
  });
  it("omits sealed internal cavities but retains genuinely open holes", () => {
    const shell = [
      block([0, 0, 0], [1, 1, 0.2]),
      block([0, 0, 0.8], [1, 1, 1]),
      block([0, 0, 0.2], [0.2, 1, 0.8]),
      block([0.8, 0, 0.2], [1, 1, 0.8]),
    ];
    expect(compoundExteriorPositions(shell).length).toBe(24 * 6);
    const closed = [
      ...shell,
      block([0.2, 0, 0.2], [0.8, 0.2, 0.8]),
      block([0.2, 0.8, 0.2], [0.8, 1, 0.8]),
    ];
    expect(compoundExteriorPositions(closed).length).toBe(12 * 6);
  });
  it("builds finite cached exterior outlines for every fixture profile", () => {
    const fixture = createFixtureScene();
    const objects = [
      ...fixture.objects,
      ...catalog.map((asset) => ({
        ...fixture.objects[0],
        assetId: asset.id,
        dimensionsM: asset.dimensionsM,
      })),
    ];
    for (const o of objects) {
      const positions = compoundExteriorPositions(
        colliderBlocks(o, assetById),
        o.dimensionsM,
      );
      expect(positions.length).toBeGreaterThan(0);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    }
  });
});
