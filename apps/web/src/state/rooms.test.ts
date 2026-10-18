// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalog,
  fixtureId,
  livingRoom,
  roomById,
  rooms,
  type RoomDefinition,
} from "@house/contracts";
import { validateObject } from "@house/scene-engine";
import { createEditor } from "./editor";
import { LocalStorageSceneRepository } from "./repository";

/** The living room moved 10 m along X, under new IDs: a room the old origin is outside of. */
const shiftedRoom: RoomDefinition = (() => {
  const dx = 10,
    shell = structuredClone(livingRoom.shell);
  shell.id = fixtureId(9001);
  shell.floor.polygonXZ = shell.floor.polygonXZ.map(([x, z]) => [x + dx, z]);
  for (const w of shell.walls) {
    w.fromXZ = [w.fromXZ[0] + dx, w.fromXZ[1]];
    w.toXZ = [w.toXZ[0] + dx, w.toXZ[1]];
  }
  return {
    roomId: fixtureId(9002),
    name: "Shifted room",
    shell,
    createScene: () => {
      const scene = livingRoom.createScene();
      return {
        ...scene,
        id: fixtureId(9003),
        roomId: fixtureId(9002),
        shellId: shell.id,
        objects: scene.objects.map((o) => ({
          ...o,
          transform: {
            ...o.transform,
            position: [
              o.transform.position[0] + dx,
              o.transform.position[1],
              o.transform.position[2],
            ],
          },
        })),
      };
    },
  };
})();

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
afterEach(() => vi.useRealTimers());

describe("room registry", () => {
  it("pairs every room's fixture scene with its own shell", () => {
    for (const room of rooms) {
      const scene = room.createScene();
      expect(scene.roomId).toBe(room.roomId);
      expect(scene.shellId).toBe(room.shell.id);
      expect(roomById(room.roomId)).toBe(room);
    }
    expect(roomById(fixtureId(404))).toBeUndefined();
  });
});

describe("an editor bound to a room", () => {
  it("validates and places furniture inside that room's own floor", () => {
    const e = createEditor(undefined, shiftedRoom);
    const scene = e.working();
    expect(e.context().room).toBe(shiftedRoom.shell);
    expect(
      scene.objects.every((o) => validateObject(scene, o, e.context()).ok),
    ).toBe(true);
    e.chooseAsset(catalog.find((a) => a.category === "side-table")!);
    const added = e.selected()!;
    expect(added.transform.position[0]).toBeGreaterThan(7.4);
    expect(e.draft.getState().conflicts[added.id]).toBeUndefined();
    e.dispose();
  });
  it("loads, saves and resets each room under its own key", async () => {
    const storage = memoryStorage(),
      lookup = (id: string) =>
        id === shiftedRoom.roomId ? shiftedRoom : roomById(id);
    const repo = new LocalStorageSceneRepository(storage, lookup);
    const e = createEditor(repo, shiftedRoom);
    await e.load();
    expect(e.scene.getState().scene.roomId).toBe(shiftedRoom.roomId);
    const sofa = e.working().objects.find((o) => o.category === "sofa")!;
    e.commit({ type: "setLock", objectId: sofa.id, locked: true });
    await vi.advanceTimersByTimeAsync(600);
    expect(
      storage.data.has(`house.scene.v1.${shiftedRoom.roomId}`),
    ).toBeTruthy();
    expect(storage.data.has(`house.scene.v1.${livingRoom.roomId}`)).toBe(false);
    expect(
      (await repo.load(shiftedRoom.roomId)).objects.find(
        (o) => o.id === sofa.id,
      )?.locked,
    ).toBe(true);
    await e.reset();
    expect(e.scene.getState().scene.objects).toEqual(
      shiftedRoom.createScene().objects,
    );
    e.dispose();
  });
  it("rejects a saved scene that belongs to a different shell", async () => {
    const storage = memoryStorage();
    const repo = new LocalStorageSceneRepository(storage, (id) =>
      id === shiftedRoom.roomId ? shiftedRoom : roomById(id),
    );
    storage.setItem(
      `house.scene.v1.${shiftedRoom.roomId}`,
      JSON.stringify({ ...shiftedRoom.createScene(), shellId: fixtureId(1) }),
    );
    await expect(repo.load(shiftedRoom.roomId)).rejects.toMatchObject({
      code: "CORRUPT_DATA",
    });
    await expect(repo.load(fixtureId(404))).rejects.toMatchObject({
      code: "CORRUPT_DATA",
    });
  });
});
