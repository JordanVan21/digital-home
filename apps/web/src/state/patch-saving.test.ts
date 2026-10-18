// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fixtureId, SceneOpSchema } from "@house/contracts";
import { diffToOps } from "@house/scene-engine";
import { createEditor } from "./editor";
import { LocalStorageSceneRepository } from "./repository";
const storage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
afterEach(() => vi.useRealTimers());
it("saves verified patches with CAS and idempotent retries, rejecting a reused key with different data", async () => {
  const e = createEditor(),
    before = structuredClone(e.working()),
    id = fixtureId(111);
  e.select(id);
  e.suggest({ type: "setFloat", objectId: id, float: true });
  e.suggest(
    {
      type: "move",
      objectId: id,
      transform: { ...e.selected()!.transform, position: [0.2, 0.731, 1.75] },
    },
    { snap: false },
  );
  expect(e.accept()).toBe(true);
  const patch = diffToOps(before, e.working(), e.context());
  expect(patch.ok).toBe(true);
  if (!patch.ok) return;
  const repo = new LocalStorageSceneRepository(storage());
  const roomId = before.roomId;
  expect(await repo.saveScenePatch(roomId, 0, "retry-key", patch.ops)).toEqual({
    revision: 1,
  });
  expect(await repo.saveScenePatch(roomId, 0, "retry-key", patch.ops)).toEqual({
    revision: 1,
  });
  expect(
    (await repo.load(roomId)).objects.find((o) => o.id === id)!.transform
      .position[1],
  ).toBe(0.731);
  await expect(
    repo.saveScenePatch(roomId, 0, "other-key", patch.ops),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    repo.saveScenePatch(roomId, 0, "retry-key", []),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const accepted = e.log
    .getState()
    .entries.find((x) => x.kind === "Accepted patch");
  expect(accepted?.operations.length).toBeGreaterThan(0);
  for (const entry of e.log.getState().entries)
    for (const op of entry.operations)
      expect(SceneOpSchema.safeParse(op).success).toBe(true);
  e.dispose();
});
it("reuses the same retry key after a save was applied but its acknowledgement was lost", async () => {
  vi.useFakeTimers();
  const repo = new LocalStorageSceneRepository(storage()),
    save = repo.saveScenePatch.bind(repo);
  const spy = vi.spyOn(repo, "saveScenePatch");
  spy.mockImplementationOnce(async (...args) => {
    await save(...args);
    throw new Error("Lost acknowledgement");
  });
  const e = createEditor(repo);
  await e.load();
  e.select(fixtureId(111));
  e.suggest({ type: "setPlan", objectId: fixtureId(111), decision: "keep" });
  expect(e.accept()).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(e.save.getState().status).toBe("error");
  e.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(e.save.getState().status).toBe("saved");
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy.mock.calls[0][2]).toBe(spy.mock.calls[1][2]);
  expect((await repo.load(e.working().roomId)).revision).toBe(1);
  e.dispose();
});
it("represents moving and resizing a stack without carrying children twice", () => {
  const e = createEditor(),
    root = e.working().objects.find((o) => o.id === fixtureId(111))!,
    child = {
      ...structuredClone(root),
      id: fixtureId(999),
      dimensionsM: [0.1, 0.1, 0.1] as [number, number, number],
      transform: {
        ...root.transform,
        position: [0.2, 0.48, 1.75] as [number, number, number],
      },
      placement: { support: "object" as const, parentId: root.id },
    };
  e.scene.setState({ scene: { ...e.working(), objects: [root, child] } });
  const before = structuredClone(e.working());
  e.suggest({
    type: "resize",
    objectId: root.id,
    dimensionsM: [0.72, 0.96, 0.72],
  });
  e.suggest(
    {
      type: "move",
      objectId: root.id,
      transform: { ...root.transform, position: [0.3, 0, 1.5] },
    },
    { snap: false },
  );
  expect(e.accept()).toBe(true);
  expect(diffToOps(before, e.working(), e.context()).ok).toBe(true);
  e.dispose();
});
