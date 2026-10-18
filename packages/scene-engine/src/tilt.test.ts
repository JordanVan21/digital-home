import { describe, expect, it } from "vitest";
import {
  assetById,
  catalog,
  createFixtureScene,
  fixtureId,
  roomShell,
  type SceneObject,
  type Tilt,
} from "@house/contracts";
import { colliderBlocks, objectsCollide } from "./collision";
import { footprint, scaledDimensions, tiltedDimensions } from "./geometry";
import { canSupport, snapToSurface, topY } from "./support";
import { validateObject } from "./operations";

const book = catalog.find((a) => a.title === "Hardcover book")!;
const chair = catalog.find((a) => a.title === "Wood-frame lounge armchair")!;
const at = (
  asset: typeof book,
  n: number,
  position: [number, number, number],
  tilt?: Tilt,
  parentId?: string,
): SceneObject => ({
  id: fixtureId(950 + n),
  assetId: asset.id,
  category: asset.category,
  displayName: asset.title,
  dimensionsM: [...asset.dimensionsM],
  transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  locked: false,
  source: "catalog",
  placement: parentId ? { support: "object", parentId } : { support: "floor" },
  ...(tilt ? { tilt } : {}),
});
const ctx = { room: roomShell, assets: assetById };

describe("decor tilt", () => {
  it("swaps height and depth for X turns, then width and height for Z turns", () => {
    expect(tiltedDimensions([1, 2, 3], { x: 1, z: 0 })).toEqual([1, 3, 2]);
    expect(tiltedDimensions([1, 2, 3], { x: 0, z: 1 })).toEqual([2, 1, 3]);
    expect(tiltedDimensions([1, 2, 3], { x: 1, z: 1 })).toEqual([3, 1, 2]);
    expect(tiltedDimensions([1, 2, 3], { x: 2, z: 2 })).toEqual([1, 2, 3]);
    expect(tiltedDimensions([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("lays a book flat: its footprint is width by height and its top is its thickness", () => {
    const [w, h, d] = book.dimensionsM;
    const flat = at(book, 0, [0, 0, 0.5], { x: 1, z: 0 });
    expect(scaledDimensions(flat)).toEqual([w, d, h]);
    expect(topY(flat)).toBeCloseTo(d, 9);
    const xs = footprint(flat).map((p) => p[0]),
      zs = footprint(flat).map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(w, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(h, 9);
  });
  it("rotates compound collider boxes with the model and keeps them normalized", () => {
    const upright = at(chair, 1, [0, 0, 0]);
    const tipped = at(chair, 2, [0, 0, 0], { x: 1, z: 0 });
    const a = colliderBlocks(upright, assetById),
      b = colliderBlocks(tipped, assetById);
    expect(b).toHaveLength(a.length);
    // Turning +90° about X maps model (x, y, z) to (x, 1 - z, y) in the unit box.
    a.forEach(([min, max], i) => {
      expect(b[i][0]).toEqual([min[0], 1 - max[2], min[1]]);
      expect(b[i][1]).toEqual([max[0], 1 - min[2], max[1]]);
    });
    // Stable identity, so cached BVHs and exposed-face lookups are reused.
    expect(colliderBlocks(tipped, assetById)).toBe(b);
  });
  it("stacks a flat book on a flat book at exactly its thickness", () => {
    const d = book.dimensionsM[2];
    const lower = at(book, 3, [0, 0, 0.5], { x: 1, z: 0 });
    const upper = at(book, 4, [0, d, 0.5], { x: 1, z: 0 }, lower.id);
    expect(canSupport(lower, upper, assetById)).toBe(true);
    expect(objectsCollide(lower, upper, assetById)).toBe(false);
    const scene = { ...createFixtureScene(), objects: [lower, upper] };
    expect(validateObject(scene, upper, ctx)).toEqual({ ok: true });
    const dropped = snapToSurface(
      scene,
      upper,
      { ...upper.transform, position: [0, d + 0.05, 0.5] },
      roomShell,
    );
    expect(dropped.transform.position[1]).toBeCloseTo(d, 9);
  });
  it("still collides a flat book pushed into an upright one", () => {
    const flat = at(book, 5, [0, 0, 0.5], { x: 1, z: 0 });
    const upright = at(book, 6, [0.05, 0, 0.5]);
    expect(objectsCollide(flat, upright, assetById)).toBe(true);
  });
});
