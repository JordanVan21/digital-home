import { expect, it } from "vitest";
import { createFixtureScene, fixtureId, roomShell } from "@house/contracts";
import { applyOp, invertOp, canSupport } from "./index";
const fixture = () => {
  const parent = createFixtureScene().objects.find(
    (o) => o.id === fixtureId(111),
  )!;
  const child = {
    ...structuredClone(parent),
    id: fixtureId(999),
    dimensionsM: [0.1, 0.1, 0.1] as [number, number, number],
    transform: {
      ...parent.transform,
      position: [0.2, 0.48, 1.75] as [number, number, number],
    },
    placement: { support: "object" as const, parentId: parent.id },
  };
  return { ...createFixtureScene(), objects: [parent, child] };
};
const ctx = { room: roomShell, assets: {} };
it("resizes a support, reseats its children without resizing them, and restores their exact poses on undo", () => {
  const before = fixture(),
    parent = before.objects[0],
    child = before.objects[1],
    op = {
      type: "resize" as const,
      objectId: parent.id,
      dimensionsM: [0.72, 0.96, 0.72] as [number, number, number],
    };
  const result = applyOp(before, op, ctx);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const resized = result.scene.objects[0],
    seated = result.scene.objects[1];
  expect(resized.dimensionsM).toEqual(op.dimensionsM);
  expect(seated.dimensionsM).toEqual(child.dimensionsM);
  expect(seated.transform.position).toEqual([0.2, 0.96, 1.75]);
  expect(canSupport(resized, seated, {})).toBe(true);
  const inverse = invertOp(before, op);
  expect(inverse.type).toBe("checkpoint");
  if (inverse.type === "checkpoint")
    expect(inverse.scene.objects).toEqual(before.objects);
});
it("rejects a resize that would move a locked supported child", () => {
  const before = fixture();
  before.objects[1].locked = true;
  const result = applyOp(
    before,
    {
      type: "resize",
      objectId: before.objects[0].id,
      dimensionsM: [0.72, 0.96, 0.72],
    },
    ctx,
    { allowConflicts: true },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("OBJECT_LOCKED");
});
