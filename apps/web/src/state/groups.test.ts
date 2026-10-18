import { expect, it } from "vitest";
import { fixtureId, SceneOpSchema } from "@house/contracts";
import { applyOp, invertOp } from "@house/scene-engine";
import { createEditor } from "./editor";
it("groups as a typed reversible suggestion, selects the group, and lets Alt pick a member", () => {
  const e = createEditor(),
    a = fixtureId(111),
    b = fixtureId(110);
  e.selectMany([a, b]);
  expect(e.groupSelection()).toBe(true);
  const group = e.selected()!.groupId;
  expect(group).toBeTruthy();
  expect(e.working().objects.find((o) => o.id === a)!.groupId).toBe(group);
  expect(e.draft.getState().undo).toHaveLength(1);
  expect(e.accept()).toBe(true);
  e.select(a);
  expect(e.interaction.getState().selectedIds).toEqual(
    expect.arrayContaining([a, b]),
  );
  e.selectMany([a], { individual: true });
  expect(e.interaction.getState().selectedIds).toEqual([a]);
  expect(e.groupSelection(true)).toBe(true);
  expect(e.working().objects.filter((o) => o.groupId === group)).toHaveLength(
    0,
  );
  e.travel("undo");
  e.select(b);
  expect(e.interaction.getState().selectedIds).toHaveLength(2);
  e.dispose();
});
it("validates and reverses group identity without changing geometry", () => {
  const e = createEditor(),
    before = e.working(),
    op = {
      type: "setGroup" as const,
      objectId: fixtureId(111),
      groupId: fixtureId(999),
    };
  expect(SceneOpSchema.safeParse(op).success).toBe(true);
  const result = applyOp(before, op, e.context());
  expect(result.ok).toBe(true);
  if (result.ok) {
    const inverse = invertOp(before, op);
    if (inverse.type !== "checkpoint") {
      const restored = applyOp(result.scene, inverse, e.context());
      expect(restored.ok && restored.scene.objects).toEqual(before.objects);
    }
  }
  e.dispose();
});
