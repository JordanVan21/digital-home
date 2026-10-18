// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureScene, fixtureId, transformAt } from "@house/contracts";
import { validateObject } from "@house/scene-engine";
import { createEditor, sceneContext } from "./editor";
import { LocalStorageSceneRepository } from "./repository";

const smallId = fixtureId(111);
const sofaId = () =>
  createFixtureScene().objects.find((o) => o.category === "sofa")!.id;
const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};
const move = (id: string, x: number, z: number, yaw = 0) => ({
  type: "move" as const,
  objectId: id,
  transform: transformAt(x, z, yaw),
});
const allValid = (e: ReturnType<typeof createEditor>) => {
  const s = e.scene.getState().scene;
  return s.objects.every((o) => validateObject(s, o, sceneContext).ok);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("suggestions phase", () => {
  it("accepts a raised piece on its support as one undoable checkpoint", () => {
    const e = createEditor();
    const small = e.working().objects.find((o) => o.id === smallId)!;
    const desk = e.working().objects.find((o) => o.category === "desk")!;
    const [x, y, z] = desk.transform.position;
    const height = y + desk.dimensionsM[1] * desk.transform.scale[1];
    e.suggest({
      type: "move",
      objectId: smallId,
      transform: { ...small.transform, position: [x, height + 0.05, z] },
    });
    expect(e.accept()).toBe(true);
    const placed = e.working().objects.find((o) => o.id === smallId)!;
    expect(placed.transform.position[1]).toBeCloseTo(height);
    expect(placed.placement).toEqual({ support: "object", parentId: desk.id });
    expect(allValid(e)).toBe(true);
    expect(e.history.getState().history.undo).toHaveLength(1);
    e.travel("undo");
    expect(
      e.working().objects.find((o) => o.id === smallId)!.transform,
    ).toEqual(small.transform);
    e.travel("redo");
    expect(
      e.working().objects.find((o) => o.id === smallId)!.placement,
    ).toEqual(placed.placement);
    e.dispose();
  });
  it("accepts a batch as one history entry and saves once", async () => {
    const repo = new LocalStorageSceneRepository(memoryStorage()),
      spy = vi.spyOn(repo, "save"),
      e = createEditor(repo);
    await e.load();
    expect(e.suggest(move(smallId, 0.4, 1.75))).toBe(true);
    expect(e.suggest(move(smallId, 0.5, 1.75))).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).not.toHaveBeenCalled();
    expect(e.accept()).toBe(true);
    expect(e.draft.getState().scene).toBeNull();
    expect(e.history.getState().history.undo).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).toHaveBeenCalledTimes(1);
    e.travel("undo");
    expect(
      e.working().objects.find((o) => o.id === smallId)?.transform.position[0],
    ).toBeCloseTo(0.2);
    e.dispose();
  });
  it("resolves a collision on accept by moving the suggested piece", () => {
    const e = createEditor();
    const sofa = e.scene
      .getState()
      .scene.objects.find((o) => o.id === sofaId())!;
    const [centerX, , sz] = sofa.transform.position;
    // The center can now fit in an empty compound region; hit the arm instead.
    const sx = centerX + 0.95;
    e.suggest(move(smallId, sx, sz));
    expect(e.draft.getState().conflicts[smallId]).toBeTruthy();
    expect(e.accept()).toBe(true);
    expect(allValid(e)).toBe(true);
    const placed = e.working().objects.find((o) => o.id === smallId)!;
    expect(placed.transform.position).not.toEqual([sx, 0, sz]);
    expect(
      e.working().objects.find((o) => o.id === sofaId())?.transform,
    ).toEqual(sofa.transform);
    expect(e.interaction.getState().toast).toMatch(/moved/i);
    expect(e.draft.getState().resolved).toContain(smallId);
    e.dispose();
  });
  it("discard restores the accepted room", () => {
    const e = createEditor(),
      before = e.scene.getState().scene;
    e.suggest({ type: "delete", objectId: smallId });
    expect(e.working().objects).toHaveLength(11);
    e.discard();
    expect(e.working()).toBe(before);
    expect(e.draft.getState().undo).toHaveLength(0);
    e.dispose();
  });
  it("reverts a single piece as its own draft step", () => {
    const e = createEditor();
    e.suggest(move(smallId, 0.5, 1.75));
    e.suggest({ type: "delete", objectId: sofaId() });
    e.revertPiece(sofaId());
    expect(e.working().objects.some((o) => o.id === sofaId())).toBe(true);
    expect(
      e.working().objects.find((o) => o.id === smallId)?.transform.position[0],
    ).toBeCloseTo(0.5);
    e.travel("undo");
    expect(e.working().objects.some((o) => o.id === sofaId())).toBe(false);
    e.dispose();
  });
  it("keeps locks immediate and enforced inside the draft", () => {
    const e = createEditor();
    e.suggest(move(smallId, 0.5, 1.75));
    e.select(smallId);
    e.toggleLock();
    expect(
      e.scene.getState().scene.objects.find((o) => o.id === smallId)?.locked,
    ).toBe(true);
    expect(e.history.getState().history.undo).toHaveLength(1);
    expect(e.suggest(move(smallId, 0.7, 1.75))).toBe(false);
    expect(e.interaction.getState().toast).toContain("locked");
    expect(e.changes()).toHaveLength(1);
    e.dispose();
  });
  it("sets free yaw as a suggestion", () => {
    const e = createEditor();
    e.select(smallId);
    e.setYaw((127 * Math.PI) / 180);
    const q = e.selected()!.transform.rotation;
    expect((2 * Math.atan2(q[1], q[3]) * 180) / Math.PI).toBeCloseTo(127);
    expect(
      e.scene.getState().scene.objects.find((o) => o.id === smallId)?.transform
        .rotation,
    ).toEqual([0, 0, 0, 1]);
    e.dispose();
  });
});

describe("snapped stack history", () => {
  it("keeps support movement, descendants, Accept, undo and redo in one checkpoint", () => {
    const e = createEditor();
    const original = e.working().objects.find((o) => o.id === smallId)!;
    const parent = {
      ...original,
      dimensionsM: [1, 0.6, 1] as [number, number, number],
      transform: transformAt(0, 0),
    };
    const child = {
      ...original,
      id: fixtureId(901),
      dimensionsM: [0.2, 0.2, 0.2] as [number, number, number],
      placement: { support: "object" as const, parentId: parent.id },
      transform: transformAt(0.2, 0, 0, 0.6),
    };
    const before = { ...e.working(), objects: [parent, child] };
    e.scene.setState({ scene: before });
    expect(e.suggest(move(parent.id, 0.5, 0))).toBe(true);
    expect(e.draft.getState().undo).toHaveLength(1);
    expect(e.working().objects[1].transform.position).toEqual([0.7, 0.6, 0]);
    e.travel("undo");
    expect(e.working().objects).toEqual(before.objects);
    e.travel("redo");
    expect(e.working().objects[1].transform.position[0]).toBeCloseTo(0.7);
    e.revertPiece(parent.id);
    expect(e.working().objects).toEqual(before.objects);
    e.travel("undo");
    expect(e.working().objects[1].transform.position[0]).toBeCloseTo(0.7);
    expect(e.accept()).toBe(true);
    expect(e.history.getState().history.undo).toHaveLength(1);
    e.travel("undo");
    expect(e.working().objects).toEqual(before.objects);
    e.travel("redo");
    expect(e.working().objects[1].transform.position[0]).toBeCloseTo(0.7);
    e.dispose();
  });
});
