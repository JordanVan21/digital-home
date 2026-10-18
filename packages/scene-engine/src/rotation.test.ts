import { describe, expect, it } from "vitest";
import {
  createFixtureScene,
  fixtureId,
  roomShell,
  type SceneObject,
} from "@house/contracts";
import { objectsCollide } from "./collision";
import { footprint } from "./geometry";
import { onNearestSurface } from "./support";
import { validateObject } from "./operations";
import { moveAssembly } from "./assembly";
const object = (n = 0): SceneObject => ({
  id: fixtureId(990 + n),
  assetId: null,
  category: "decor",
  displayName: "Box",
  dimensionsM: [0.4, 1, 0.2],
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  locked: false,
  source: "catalog",
  placement: { support: "floor" },
});
const pitch = (a: number): [number, number, number, number] => [
  Math.sin(a / 2),
  0,
  0,
  Math.cos(a / 2),
];
describe("full rotation", () => {
  it("allows arbitrary pitch in free drafts", () => {
    const o = object();
    o.transform.rotation = pitch(Math.PI / 5);
    expect(
      validateObject(
        { ...createFixtureScene(), objects: [o] },
        o,
        { room: roomShell, assets: {} },
        { allowConflicts: true },
      ),
    ).toEqual({ ok: true });
  });
  it("projects the rotated shape into its footprint", () => {
    const o = object();
    o.transform.rotation = pitch(Math.PI / 2);
    const zs = footprint(o).map((p) => p[1]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1);
  });
  it("settles the actual lowest point, keeping the chosen rotation", () => {
    const o = object();
    o.transform.rotation = pitch(Math.PI / 4);
    o.transform.position[1] = 0.2;
    const settled = onNearestSurface(
      { ...createFixtureScene(), objects: [o] },
      o,
      roomShell,
      {},
    );
    expect(settled.transform.position[1]).toBeCloseTo(Math.SQRT1_2 * 0.1);
    expect(settled.transform.rotation).toEqual(o.transform.rotation);
    expect(
      validateObject({ ...createFixtureScene(), objects: [settled] }, settled, {
        room: roomShell,
        assets: {},
      }).ok,
    ).toBe(false);
  });
  it("detects collision with the tipped extension, not the upright box", () => {
    const a = object(),
      b = object(1);
    a.transform.rotation = pitch(Math.PI / 2);
    b.dimensionsM = [0.1, 0.1, 0.1];
    b.transform.position = [0, 0.02, 0.7];
    expect(objectsCollide(a, b, {})).toBe(true);
    b.transform.position = [0, 0.5, 0];
    expect(objectsCollide(a, b, {})).toBe(false);
  });
  it("carries children through pitch without flattening their rotation", () => {
    const a = object(),
      b = object(1);
    b.transform.position = [0, 1, 0];
    b.placement = { support: "object", parentId: a.id };
    const result = moveAssembly(
      { ...createFixtureScene(), objects: [a, b] },
      a.id,
      { ...a.transform, rotation: pitch(Math.PI / 2) },
    );
    expect(result.objects[1].transform.position[2]).toBeCloseTo(1);
    expect(result.objects[1].transform.position[1]).toBeCloseTo(0);
    expect(result.objects[1].transform.rotation[0]).toBeCloseTo(Math.SQRT1_2);
  });
});
it("rejects a leaning block whose centre lies beyond its only contact edge", () => {
  const o = object();
  o.transform.rotation = pitch(Math.PI / 4);
  o.transform.position[1] = Math.SQRT1_2 * 0.1;
  const result = validateObject({ ...createFixtureScene(), objects: [o] }, o, {
    room: roomShell,
    assets: {},
  });
  expect(result.ok).toBe(false);
});
