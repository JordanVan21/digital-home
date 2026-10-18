// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetById,
  catalog,
  fixtureId,
  livingRoom,
  SceneSpecSchema,
  type RoomDefinition,
} from "@house/contracts";
import { validateObject } from "@house/scene-engine";
import { contextFor, createEditor } from "./editor";
import { LocalStorageSceneRepository } from "./repository";
import { roomById, rooms } from "./rooms";

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
  it("offers the living room, test2, the demo studio and the scanned studio", () => {
    expect(rooms.map((r) => r.name)).toEqual([
      "Living room",
      "test2 · warm living room",
      "Demo studio",
      "Scanned studio",
    ]);
    expect(new Set(rooms.map((r) => r.roomId)).size).toBe(rooms.length);
  });
  it("starts every room from a valid scene whose assets and parents exist", () => {
    for (const room of rooms) {
      const scene = room.createScene();
      expect(SceneSpecSchema.parse(scene)).toBeTruthy();
      const ids = new Set(scene.objects.map((o) => o.id));
      for (const o of scene.objects) {
        if (o.assetId) expect(assetById[o.assetId], o.displayName).toBeTruthy();
        const parent = o.placement?.parentId;
        if (parent)
          expect(
            o.placement?.support === "wall"
              ? room.shell.walls.some((w) => w.id === parent)
              : ids.has(parent),
            o.displayName,
          ).toBe(true);
      }
      // A fresh copy each time: editing one scene never leaks into the next.
      expect(room.createScene()).not.toBe(scene);
      expect(room.createScene().objects[0]).not.toBe(scene.objects[0]);
    }
  });
  it("reproduces the scan as catalog matches plus labelled placeholders", () => {
    const scan = roomById(rooms[3].roomId)!.createScene();
    expect(scan.objects).toHaveLength(7);
    expect(
      scan.objects.every((o) => o.source === "roomplan_approximation"),
    ).toBe(true);
    expect(
      scan.objects
        .filter((o) => o.assetId === null)
        .map((o) => o.category)
        .sort(),
    ).toEqual(["fireplace", "storage"]);
  });
  it("keeps test2's 45 pieces, tilts, finishes and appearance", () => {
    const test2 = rooms[1].createScene();
    expect(test2.objects).toHaveLength(45);
    expect(test2.objects.filter((o) => o.tilt)).toHaveLength(7);
    expect(test2.objects.filter((o) => o.materialOverrides)).toHaveLength(19);
    expect(test2.appearance).toEqual({
      wallColor: "#efe6da",
      floorMaterial: "honey",
    });
    expect(rooms[1].photoCamera?.fov).toBe(32);
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

describe("switching rooms", () => {
  const test2 = () => rooms[1];
  it("loads the other room with its own shell and clears history and selection", async () => {
    const storage = memoryStorage(),
      repo = new LocalStorageSceneRepository(storage);
    const e = createEditor(repo);
    await e.load();
    const sofa = e.working().objects.find((o) => o.category === "sofa")!;
    e.commit({ type: "setLock", objectId: sofa.id, locked: true });
    e.select(sofa.id);
    await e.switchRoom(test2().roomId);
    expect(e.room.getState().room).toBe(test2());
    expect(e.context().room).toBe(test2().shell);
    expect(e.scene.getState().scene.roomId).toBe(test2().roomId);
    expect(e.scene.getState().ready).toBe(true);
    expect(e.history.getState().history.undo).toHaveLength(0);
    expect(e.interaction.getState().selectedId).toBeNull();
    // The previous room's pending edit was saved before leaving.
    expect(
      (await repo.load(livingRoom.roomId)).objects.find((o) => o.id === sofa.id)
        ?.locked,
    ).toBe(true);
    await e.switchRoom(livingRoom.roomId);
    expect(e.working().objects.find((o) => o.id === sofa.id)?.locked).toBe(
      true,
    );
    e.dispose();
  });
  it("keeps the room while there are unaccepted suggestions", async () => {
    const e = createEditor(new LocalStorageSceneRepository(memoryStorage()));
    await e.load();
    const sofa = e.working().objects.find((o) => o.category === "sofa")!;
    e.suggest({ type: "delete", objectId: sofa.id });
    expect(await e.switchRoom(test2().roomId)).toBe(false);
    expect(e.room.getState().room).toBe(livingRoom);
    expect(e.interaction.getState().toast).toMatch(/Accept or discard/);
    e.dispose();
  });
});

describe("Jordan's fixtures in this engine's conventions", () => {
  const imported = () => rooms.slice(1);
  it("puts each wall's inner face on the floor edge, centreline outside", () => {
    for (const room of imported()) {
      const floor = room.shell.floor.polygonXZ;
      for (const w of room.shell.walls) {
        const [ax, az] = w.fromXZ,
          [bx, bz] = w.toXZ;
        const len = Math.hypot(bx - ax, bz - az);
        // Distance from the wall centreline to the nearest floor edge is half its thickness.
        const nearest = Math.min(
          ...floor.map((p, i) => {
            const q = floor[(i + 1) % floor.length];
            const mx = (p[0] + q[0]) / 2,
              mz = (p[1] + q[1]) / 2;
            return Math.abs(
              ((bx - ax) * (az - mz) - (ax - mx) * (bz - az)) / len,
            );
          }),
        );
        expect(nearest, room.name).toBeCloseTo(w.thicknessM / 2, 6);
      }
    }
  });
  it("keeps openings at the same place along their walls", () => {
    const test2 = rooms[1].shell;
    const door = test2.openings.find((o) => o.kind === "door")!;
    const wall = test2.walls.find((w) => w.id === door.wallId)!;
    // Wall starts half a neighbour's thickness beyond the floor corner.
    // Authored 1.05 m from the floor corner; the wall now starts 0.1 m before it.
    expect(door.offsetM).toBeCloseTo(1.05 + 0.1, 6);
    expect(
      Math.hypot(wall.toXZ[0] - wall.fromXZ[0], wall.toXZ[1] - wall.fromXZ[1]),
    ).toBeCloseTo(5.0, 6);
  });
  it("leaves flush furniture clear of the walls and hangs wall art on a wall", () => {
    for (const room of imported()) {
      const scene = room.createScene(),
        ctx = contextFor(room);
      for (const o of scene.objects) {
        const r = validateObject(scene, o, ctx);
        if (!r.ok)
          expect(r.error.message, `${room.name}: ${o.displayName}`).not.toMatch(
            /space from the wall|inside the room|supporting wall/,
          );
        if (o.placement?.support === "wall")
          expect(room.shell.walls.map((w) => w.id)).toContain(
            o.placement.parentId,
          );
      }
    }
  });
});

describe("test2's tilted decor", () => {
  it("rests the flat book stacks on the coffee table and sideboard", () => {
    const room = rooms[1],
      scene = room.createScene(),
      ctx = contextFor(room);
    const byId = new Map(scene.objects.map((o) => [o.id, o]));
    const onTable = (o: (typeof scene.objects)[number]) => {
      let p = o.placement?.parentId
        ? byId.get(o.placement.parentId)
        : undefined;
      while (p && p.placement?.support === "object")
        p = byId.get(p.placement.parentId!);
      return (
        p &&
        ["Travertine coffee table", "Oak sideboard"].includes(p.displayName)
      );
    };
    const stacked = scene.objects.filter(
      (o) => onTable(o) && (o.tilt || o.category === "decor"),
    );
    expect(stacked.length).toBeGreaterThanOrEqual(6);
    for (const o of stacked)
      expect(validateObject(scene, o, ctx), o.displayName).toEqual({
        ok: true,
      });
  });
});
