// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  assetById,
  catalog,
  createFixtureScene,
  fixtureId,
} from "@house/contracts";
import { rotationDegrees } from "@house/scene-engine";
import { createEditor, DragSession, editor } from "./editor";
import {
  Autosave,
  LocalStorageSceneRepository,
  type SceneRepository,
  type SaveState,
} from "./repository";
import { ObjectToolbar } from "../components/ObjectToolbar";
import { InspectorPanel } from "../components/InspectorPanel";
const smallId = fixtureId(111);
const position = (x: number, z = 1.75) => ({
  position: [x, 0, z] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("adding furniture", () => {
  it("places new pieces with room to rotate in place", () => {
    const e = createEditor();
    for (const asset of catalog.filter(
      (a) =>
        ["side-table", "armchair", "plant"].includes(a.category) &&
        !a.id.startsWith("a55e7000-") &&
        // Batch-imported Poly Haven pieces include oversized lounge chairs; this
        // check covers the curated set's placement guarantee.
        !a.id.startsWith("00000000-0000-4000-8000-0000000021"),
    )) {
      e.chooseAsset(asset);
      const added = e.selected();
      expect(added?.assetId).toBe(asset.id);
      e.rotate(1);
      expect(e.selected()?.transform.rotation[1]).toBeCloseTo(
        Math.sin(Math.PI / 24),
      );
      expect(e.draft.getState().conflicts[added!.id]).toBeUndefined();
    }
    e.dispose();
  });
  it("places every catalog piece, keeping free wall turns until Accept", () => {
    for (const asset of catalog) {
      const e = createEditor();
      e.scene.setState({
        scene: { ...e.scene.getState().scene, objects: [] },
      });
      e.chooseAsset(asset);
      const added = e.selected();
      expect(added?.assetId, asset.title).toBe(asset.id);
      e.rotate(1);
      if (asset.mount === "wall") {
        expect(e.draft.getState().conflicts[added!.id]).toBeDefined();
        expect(e.accept()).toBe(true);
      }
      expect(
        e.draft.getState().conflicts[added!.id],
        asset.title,
      ).toBeUndefined();
      e.dispose();
    }
  });
});
describe("gesture integration", () => {
  it("keeps previews out of state and records one draft step on release", () => {
    const e = createEditor(),
      session = new DragSession(e),
      before = e.scene.getState().scene;
    expect(session.begin(smallId)).toBe(true);
    for (let i = 0; i < 100; i++)
      expect(session.preview(position(0.2 + i * 0.001)).ok).toBe(true);
    expect(e.draft.getState().scene).toBeNull();
    expect(session.release()).toBe(true);
    expect(e.scene.getState().scene).toBe(before);
    expect(e.history.getState().history.undo).toHaveLength(0);
    expect(e.draft.getState().undo).toHaveLength(1);
    expect(
      e.working().objects.find((o) => o.id === smallId)?.transform.position[0],
    ).toBeCloseTo(0.299);
    e.travel("undo");
    expect(e.draft.getState().scene).toBeNull();
    expect(e.working()).toBe(before);
    e.travel("redo");
    expect(e.draft.getState().scene).not.toBeNull();
    e.dispose();
  });
  it("lets invalid drops land as conflicted suggestions", () => {
    const e = createEditor(),
      session = new DragSession(e),
      before = e.scene.getState().scene;
    session.begin(smallId);
    expect(session.preview(position(20)).ok).toBe(false);
    expect(session.release()).toBe(true);
    expect(e.scene.getState().scene).toBe(before);
    expect(
      e.working().objects.find((o) => o.id === smallId)?.transform.position[0],
    ).toBe(20);
    expect(e.draft.getState().conflicts[smallId]).toContain("inside");
    expect(e.interaction.getState().dragging).toBe(false);
    e.dispose();
  });
  it("locked objects reject drags and canceling a gesture creates no edit", () => {
    const e = createEditor(),
      session = new DragSession(e),
      desk = e.scene.getState().scene.objects.find((o) => o.locked)!;
    expect(session.begin(desk.id)).toBe(false);
    expect(e.interaction.getState().toast).toContain("locked");
    session.begin(smallId);
    session.preview(position(0.4));
    session.cancel();
    session.release();
    expect(e.draft.getState().scene).toBeNull();
    e.dispose();
  });
  it("suggests adds and visual replacements without touching the accepted room", () => {
    const e = createEditor(),
      asset = Object.values(assetById).find(
        (a) => a.category === "side-table",
      )!;
    e.chooseAsset(asset);
    expect(e.working().objects).toHaveLength(13);
    expect(e.scene.getState().scene.objects).toHaveLength(12);
    e.select(smallId);
    const original = e.selected()!.transform;
    e.interaction.setState({ replacing: true, browser: true });
    e.chooseAsset(asset);
    expect(e.selected()!.transform).toEqual(original);
    expect(e.selected()!.assetId).toBe(asset.id);
    e.travel("undo");
    expect(e.selected()!.assetId).toBe(null);
    e.dispose();
  });
});
describe("serialized debounced autosave", () => {
  it("saves once after a burst and restores it through the repository", async () => {
    const storage = memoryStorage(),
      repo = new LocalStorageSceneRepository(storage),
      spy = vi.spyOn(repo, "saveScenePatch"),
      e = createEditor(repo);
    await e.load();
    for (let i = 0; i < 4; i++) {
      e.commit({
        type: "move",
        objectId: smallId,
        transform: position(0.2 + i * 0.04),
      });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(e.save.getState().status).toBe("saved");
    const restored = await repo.load(createFixtureScene().roomId);
    expect(restored.objects.at(-1)?.transform.position[0]).toBeCloseTo(0.32);
    expect(restored.revision).toBe(1);
    e.dispose();
  });
  it("never overlaps saves, then saves the latest pending scene against the acknowledged revision", async () => {
    let snapshot = createFixtureScene(),
      resolve: ((r: { revision: number }) => void) | undefined;
    const save = vi
      .fn<SceneRepository["save"]>()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockImplementation(async (s) => ({ revision: s.revision }));
    const repo: SceneRepository = { load: async () => snapshot, save },
      status = vi.fn<(s: SaveState) => void>(),
      queue = new Autosave(repo, () => snapshot, status, 0);
    snapshot = { ...snapshot, revision: 1 };
    queue.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    snapshot = { ...snapshot, revision: 2 };
    queue.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    resolve!({ revision: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe(1);
    expect(status).toHaveBeenLastCalledWith({ status: "saved", error: null });
    queue.dispose();
  });
  it("keeps local edits after save failure and retries without losing changes", async () => {
    const save = vi
      .fn<SceneRepository["save"]>()
      .mockRejectedValueOnce(new Error("Storage full"))
      .mockResolvedValue({ revision: 1 });
    const e = createEditor({ load: async () => createFixtureScene(), save });
    await e.load();
    e.commit({ type: "move", objectId: smallId, transform: position(0.3) });
    await vi.advanceTimersByTimeAsync(500);
    expect(e.save.getState()).toEqual({
      status: "error",
      error: "Storage full",
    });
    expect(e.scene.getState().scene.revision).toBe(1);
    e.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.save.getState().status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
    e.dispose();
  });
  it("rejects a stale revision and corrupt saved data with typed errors", async () => {
    const storage = memoryStorage(),
      repo = new LocalStorageSceneRepository(storage),
      fixture = createFixtureScene();
    await repo.save({ ...fixture, revision: 1 }, 0);
    await expect(
      repo.save({ ...fixture, revision: 2 }, 0),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    storage.data.set(`house.scene.v1.${fixture.roomId}`, "invalid");
    await expect(repo.load(fixture.roomId)).rejects.toMatchObject({
      code: "CORRUPT_DATA",
    });
  });
});
describe("accessible editor controls", () => {
  it("disables destructive controls for the locked desk and supports explicit unlocking", () => {
    editor.scene.setState({ scene: createFixtureScene(), ready: true });
    editor.interaction.setState({
      selectedId: fixtureId(109),
      inspector: true,
      dragging: false,
    });
    const desk = editor.scene
      .getState()
      .scene.objects.find((o) => o.id === fixtureId(109))!;
    render(
      <>
        <ObjectToolbar object={desk} />
        <InspectorPanel />
      </>,
    );
    for (const name of [
      "Move (G)",
      "Move up or down (Y)",
      "Rotate freely (Shift to snap)",
      "Delete (Backspace)",
    ])
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    expect(
      (screen.getByLabelText("Height in meters") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Delete selected object",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Rotate clockwise 15°",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock selected object" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Delete selected object",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("spatial controls", () => {
  it("edits every rotation axis and quick poses through one suggestion per action", () => {
    editor.discard();
    editor.select(smallId);
    editor.interaction.setState({ inspector: true, dragging: false });
    render(<InspectorPanel />);
    const pitch = screen.getByLabelText("X (pitch) in degrees");
    fireEvent.change(pitch, { target: { value: "25" } });
    fireEvent.blur(pitch);
    expect(
      rotationDegrees(editor.selected()!.transform.rotation)[0],
    ).toBeCloseTo(25);
    expect(editor.draft.getState().undo).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Z (roll) plus 15°" }),
    );
    expect(
      rotationDegrees(editor.selected()!.transform.rotation)[2],
    ).toBeCloseTo(15);
    expect(editor.draft.getState().undo).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Lean back 15°" }));
    expect(
      rotationDegrees(editor.selected()!.transform.rotation)[0],
    ).toBeCloseTo(-15);
    fireEvent.click(screen.getByRole("button", { name: "Lay flat" }));
    expect(
      rotationDegrees(editor.selected()!.transform.rotation)[0],
    ).toBeCloseTo(90);
    expect(editor.draft.getState().undo).toHaveLength(4);
    editor.discard();
  });
  it("chooses a movement plane or Rotate without creating edits and supports exact height", () => {
    const object = editor.working().objects.find((o) => o.id === smallId)!;
    editor.select(object.id);
    editor.interaction.setState({ inspector: true });
    render(
      <>
        <ObjectToolbar object={object} />
        <InspectorPanel />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate freely (Shift to snap)" }),
    );
    expect(editor.interaction.getState().tool).toBe("rotate");
    expect(editor.draft.getState().undo).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Move up or down (Y)" }),
    );
    expect(editor.interaction.getState().movePlane).toBe("height");
    expect(editor.interaction.getState().tool).toBe("move");
    const input = screen.getByLabelText("Height in meters");
    fireEvent.change(input, { target: { value: "0.6" } });
    fireEvent.blur(input);
    expect(
      editor.working().objects.find((o) => o.id === smallId)!.transform
        .position[1],
    ).toBe(0.6);
    fireEvent.click(screen.getByRole("button", { name: "Move (G)" }));
    expect(editor.interaction.getState().movePlane).toBe("floor");
  });
});

describe("local recovery and concurrency", () => {
  it("explicit reset replaces unreadable data with a usable fixture", async () => {
    const storage = memoryStorage();
    storage.data.set(`house.scene.v1.${createFixtureScene().roomId}`, "broken");
    const repo = new LocalStorageSceneRepository(storage),
      e = createEditor(repo);
    await e.load();
    expect(e.scene.getState().ready).toBe(false);
    await e.reset();
    expect(e.scene.getState().ready).toBe(true);
    expect(e.save.getState().status).toBe("saved");
    expect((await repo.load(createFixtureScene().roomId)).objects).toEqual(
      createFixtureScene().objects,
    );
    e.dispose();
  });
  it("rejects one of two concurrent stale writes without overwriting the winner", async () => {
    const repo = new LocalStorageSceneRepository(memoryStorage()),
      fixture = createFixtureScene();
    const writes = await Promise.allSettled([
      repo.save({ ...fixture, revision: 1 }, 0),
      repo.save({ ...fixture, revision: 2 }, 0),
    ]);
    expect(writes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(writes.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect((await repo.load(fixture.roomId)).revision).toBe(1);
  });
  it("reset is persisted and survives a reload, and clears history", async () => {
    const repo = new LocalStorageSceneRepository(memoryStorage()),
      e = createEditor(repo);
    await e.load();
    e.commit({ type: "move", objectId: smallId, transform: position(0.5) });
    await e.reset();
    expect(e.history.getState().history.undo).toHaveLength(0);
    expect(e.save.getState().status).toBe("saved");
    expect((await repo.load(createFixtureScene().roomId)).objects).toEqual(
      createFixtureScene().objects,
    );
    e.dispose();
  });
  it("converts disabled storage into a typed error", async () => {
    const repo = new LocalStorageSceneRepository({
      getItem: () => {
        throw new Error("Denied");
      },
      setItem: () => {
        throw new Error("Denied");
      },
    });
    await expect(repo.load(createFixtureScene().roomId)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
});
