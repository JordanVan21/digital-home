import { expect, it } from "vitest";
import { fixtureId } from "@house/contracts";
import { createEditor, DragSession } from "./editor";
it("selects multiple pieces and moves them in one undoable gesture without double-moving supported children", () => {
  const e = createEditor();
  const a = fixtureId(111),
    b = fixtureId(110);
  e.selectMany([a, b]);
  expect(e.interaction.getState().selectedIds).toEqual([a, b]);
  const before = structuredClone(e.working());
  const root = before.objects.find((o) => o.id === a)!;
  const drag = new DragSession(e);
  expect(drag.begin(a)).toBe(true);
  const transform = {
    ...root.transform,
    position: root.transform.position.map(
      (v, i) => v + (i === 0 ? 0.2 : 0),
    ) as [number, number, number],
  };
  e.previewMove(a, transform);
  expect(e.motion.transforms.has(b)).toBe(true);
  drag.preview(transform);
  drag.release();
  expect(e.draft.getState().undo).toHaveLength(1);
  for (const id of [a, b])
    expect(
      e.working().objects.find((o) => o.id === id)!.transform.position[0],
    ).toBeCloseTo(
      before.objects.find((o) => o.id === id)!.transform.position[0] + 0.2,
    );
  e.travel("undo");
  expect(e.working()).toEqual(before);
  e.dispose();
});
it("toggles membership, ignores stale IDs, and makes a locked selection atomic", () => {
  const e = createEditor();
  const a = fixtureId(111),
    b = fixtureId(110);
  e.selectMany([a, b, "missing", a]);
  expect(e.interaction.getState().selectedIds).toEqual([a, b]);
  e.toggleSelection(b);
  expect(e.interaction.getState().selectedIds).toEqual([a]);
  e.select(b);
  e.toggleLock();
  e.selectMany([a, b]);
  expect(e.nudge(1, 0)).toBe(false);
  expect(e.hasDraft()).toBe(false);
  e.dispose();
});
it("carries a selected supported child only once when its support is also selected", () => {
  const e = createEditor(),
    id = fixtureId(111),
    root = e.working().objects.find((o) => o.id === id)!;
  const child = {
    ...structuredClone(root),
    id: fixtureId(999),
    dimensionsM: [0.1, 0.1, 0.1] as [number, number, number],
    transform: {
      ...root.transform,
      position: [0.2, 0.48, 1.75] as [number, number, number],
    },
    placement: { support: "object" as const, parentId: id },
  };
  e.scene.setState({
    scene: { ...e.working(), objects: [...e.working().objects, child] },
  });
  e.selectMany([id, child.id]);
  e.motion.cameraDirection = [1, 0, 0];
  expect(e.nudge(1, 0)).toBe(true);
  expect(
    e.working().objects.find((o) => o.id === child.id)!.transform.position[0],
  ).toBeCloseTo(0.22);
  e.dispose();
});
