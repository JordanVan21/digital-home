import { expect, it } from "vitest";
import {
  createFixtureScene,
  roomShell,
  fixtureId,
  SceneObjectSchema,
} from "@house/contracts";
import {
  onWall,
  onCeiling,
  validateObject,
  resolveDraft,
  verticalBounds,
} from "./index";
const base = () => ({
  ...createFixtureScene().objects.find((o) => o.id === fixtureId(111))!,
  category: "wall-art",
  dimensionsM: [0.6, 0.5, 0.03] as [number, number, number],
  transform: {
    position: [2.4, 1, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  },
});
const ctx = { room: roomShell, assets: {} };
it("mounts artwork on the nearest inner wall face and turns around corners", () => {
  const art = onWall(roomShell, base());
  expect(art.placement?.parentId).toBe(fixtureId(11));
  expect(art.transform.position[0]).toBeCloseTo(2.525);
  expect(
    validateObject({ ...createFixtureScene(), objects: [art] }, art, ctx).ok,
  ).toBe(true);
  const corner = onWall(roomShell, {
    ...art,
    transform: { ...art.transform, position: [0.8, 1, 2.4] },
  });
  expect(corner.placement?.parentId).toBe(fixtureId(12));
  expect(corner.transform.position[2]).toBeCloseTo(2.125);
  expect(
    validateObject({ ...createFixtureScene(), objects: [corner] }, corner, ctx)
      .ok,
  ).toBe(true);
});
it("rejects artwork over an opening or intersecting another object", () => {
  const window = onWall(roomShell, {
    ...base(),
    transform: { ...base().transform, position: [-2.4, 1, 0] },
  });
  expect(
    validateObject({ ...createFixtureScene(), objects: [window] }, window, ctx)
      .ok,
  ).toBe(false);
  const art = onWall(roomShell, base()),
    obstacle = { ...art, id: fixtureId(999) };
  expect(
    validateObject(
      { ...createFixtureScene(), objects: [art, obstacle] },
      art,
      ctx,
    ).ok,
  ).toBe(false);
});
it("allows free ceiling drafts, then accepts exact ceiling contact without dropping to the floor", () => {
  const pendant = {
    ...base(),
    category: "lamp",
    placement: { support: "ceiling" as const },
    dimensionsM: [0.4, 0.9, 0.4] as [number, number, number],
    transform: {
      ...base().transform,
      position: [0, 0.4, 0] as [number, number, number],
    },
  };
  expect(SceneObjectSchema.safeParse(pendant).success).toBe(true);
  const snapped = onCeiling(roomShell, pendant);
  expect(verticalBounds(snapped).top).toBeCloseTo(roomShell.ceilingHeightM!);
  const before = { ...createFixtureScene(), objects: [] };
  const result = resolveDraft(before, { ...before, objects: [pendant] }, ctx);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.scene.objects[0].placement?.support).toBe("ceiling");
    expect(verticalBounds(result.scene.objects[0]).top).toBeCloseTo(
      roomShell.ceilingHeightM!,
    );
  }
});
