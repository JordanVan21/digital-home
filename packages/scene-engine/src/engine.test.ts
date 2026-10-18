import { describe, expect, it } from "vitest";
import {
  catalog,
  assetById,
  fixtureId,
  createFixtureScene,
  roomShell,
  transformAt,
  type SceneObject,
  type SceneOp,
  type SceneSpec,
} from "@house/contracts";
import {
  applyOp,
  invertOp,
  validateObject,
  validateOp,
  type SceneContext,
} from "./operations";
import { doorClearances, insidePolygon, overlaps, rectangle } from "./geometry";
import { createHistory, record, traverseHistory } from "./history";
const ctx: SceneContext = {
  room: roomShell,
  assets: assetById,
  roomId: createFixtureScene().roomId,
};
const empty = (): SceneSpec => ({ ...createFixtureScene(), objects: [] });
const box = (id = 500, x = 0, z = 0, yaw = 0): SceneObject => ({
  id: fixtureId(id),
  assetId: null,
  displayName: `Box ${id}`,
  category: "table",
  dimensionsM: [1, 0.5, 1],
  locked: false,
  source: "user",
  placement: { support: "floor" },
  transform: transformAt(x, z, yaw),
});
const mustApply = (s: SceneSpec, op: SceneOp, c = ctx) => {
  const r = applyOp(s, op, c);
  if (!r.ok) throw new Error(r.error.message);
  return r.scene;
};
const code = (s: SceneSpec, op: SceneOp, c = ctx) => {
  const r = validateOp(s, op, c);
  return r.ok ? "OK" : r.error.code;
};
describe("geometry", () => {
  it("separates touching from overlap with SAT, also when rotated", () => {
    expect(overlaps(rectangle([0, 0], 1, 1), rectangle([1, 0], 1, 1))).toBe(
      false,
    );
    expect(overlaps(rectangle([0, 0], 1, 1), rectangle([0.999, 0], 1, 1))).toBe(
      true,
    );
    expect(
      overlaps(
        rectangle([0, 0], 2, 0.3, Math.PI / 4),
        rectangle([0, 0], 0.3, 2, Math.PI / 4),
      ),
    ).toBe(true);
    expect(
      overlaps(
        rectangle([0, 0], 2, 0.2, Math.PI / 4),
        rectangle([0.6, 0.6], 2, 0.2, Math.PI / 4),
      ),
    ).toBe(false);
  });
  it("checks rotated footprints rather than unrotated dimensions", () => {
    const o = box(500, 2, 0);
    o.dimensionsM = [0.6, 0.5, 1.6];
    expect(code(empty(), { type: "add", object: o })).toBe("OK");
    o.transform = transformAt(2, 0, Math.PI / 4);
    expect(code(empty(), { type: "add", object: o })).toBe("OUT_OF_BOUNDS");
  });
  it("rejects concave-boundary crossings even with all four corners inside", () => {
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [3, 4],
      [3, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    expect(insidePolygon(rectangle([2, 2], 3.6, 0.5), polygon)).toBe(false);
    expect(insidePolygon(rectangle([0.5, 2], 0.8, 1), polygon)).toBe(true);
  });
});
describe("operation validation and purity", () => {
  it("starts with a valid, collision-free fixture", () => {
    const scene = createFixtureScene();
    for (const o of scene.objects)
      expect(validateObject(scene, o, ctx), o.displayName).toEqual({
        ok: true,
      });
  });
  it("adds immutably and increments revision exactly once", () => {
    const scene = empty(),
      original = structuredClone(scene),
      o = box();
    const next = mustApply(scene, { type: "add", object: o });
    expect(scene).toEqual(original);
    expect(next.revision).toBe(scene.revision + 1);
    expect(next.objects).toEqual([o]);
    next.objects[0].transform.position[0] = 9;
    expect(o.transform.position[0]).toBe(0);
  });
  it("rejects duplicate IDs, unknown objects, assets and room mismatches", () => {
    const o = box(),
      s = { ...empty(), objects: [o] };
    expect(code(s, { type: "add", object: o })).toBe("DUPLICATE_ID");
    expect(code(s, { type: "delete", objectId: fixtureId(900) })).toBe(
      "UNKNOWN_OBJECT",
    );
    expect(
      code(empty(), { type: "add", object: { ...o, assetId: fixtureId(900) } }),
    ).toBe("UNKNOWN_ASSET");
    expect(
      code(
        s,
        { type: "delete", objectId: o.id },
        { ...ctx, roomId: fixtureId(900) },
      ),
    ).toBe("ROOM_MISMATCH");
    expect(
      code(
        s,
        { type: "delete", objectId: o.id },
        { ...ctx, room: { ...roomShell, id: fixtureId(900) } },
      ),
    ).toBe("ROOM_MISMATCH");
    expect(
      code(
        empty(),
        { type: "add", object: { ...o, assetId: catalog[0].id } },
        {
          ...ctx,
          assets: {
            [catalog[0].id]: { ...catalog[0], licenseStatus: "pending" },
          },
        },
      ),
    ).toBe("UNKNOWN_ASSET");
  });
  it("blocks every destructive op on locked objects, permits explicit unlocking", () => {
    const o = { ...box(), locked: true },
      s = { ...empty(), objects: [o] };
    const ops: SceneOp[] = [
      { type: "delete", objectId: o.id },
      { type: "move", objectId: o.id, transform: transformAt(1, 0) },
      {
        type: "replaceAsset",
        objectId: o.id,
        assetId: catalog[0].id,
        dimensionsM: catalog[0].dimensionsM,
      },
      {
        type: "changeMaterial",
        objectId: o.id,
        overrides: { "*": { colorHex: "#abcdef" } },
      },
      { type: "replacePhysicalItem", oldObjectId: o.id, newObject: box(501) },
    ];
    ops.forEach((op) => expect(code(s, op)).toBe("OBJECT_LOCKED"));
    expect(
      mustApply(s, { type: "setLock", objectId: o.id, locked: false })
        .objects[0].locked,
    ).toBe(false);
  });
  it("allows rugs under objects and explicitly supported wall/desk objects", () => {
    const parent = box(),
      s = { ...empty(), objects: [parent] };
    expect(code(s, { type: "add", object: box(501) })).toBe("COLLISION");
    expect(
      code(s, { type: "add", object: { ...box(501), category: "rug" } }),
    ).toBe("OK");
    const lamp = {
      ...box(501),
      placement: { support: "object" as const, parentId: parent.id },
      transform: transformAt(0, 0, 0, 0.5),
    };
    expect(code(s, { type: "add", object: lamp })).toBe("OK");
    expect(
      code(s, {
        type: "add",
        object: {
          ...box(501),
          placement: { support: "wall", parentId: roomShell.walls[0].id },
        },
      }),
    ).toBe("OK");
    expect(
      code(s, {
        type: "add",
        object: { ...lamp, placement: { support: "object" } },
      }),
    ).toBe("INVALID_SUPPORT");
    expect(
      code(
        { ...s, objects: [parent, lamp] },
        { type: "delete", objectId: parent.id },
      ),
    ).toBe("INVALID_SUPPORT");
  });
  it("keeps a swing-sized zone for swinging doors and a walkway for sliding ones", () => {
    const door = roomShell.openings.find((o) => o.kind === "door")!;
    const depth = (shell: typeof roomShell) => {
      const zone = doorClearances(shell)[0];
      const [a, b, c] = zone;
      return Math.min(
        Math.hypot(b[0] - a[0], b[1] - a[1]),
        Math.hypot(c[0] - b[0], c[1] - b[1]),
      );
    };
    const swinging = depth(roomShell);
    expect(swinging).toBeCloseTo(door.widthM + 0.1, 6);
    const sliding = {
      ...roomShell,
      openings: roomShell.openings.map((o) =>
        o.id === door.id ? { ...o, widthM: 2.5, swing: "none" as const } : o,
      ),
    };
    // A 2.5 m sliding door keeps 0.9 m clear in front, not a 2.65 m swing arc.
    const zone = doorClearances(sliding)[0];
    const sides = [0, 1].map((i) =>
      Math.hypot(zone[i + 1][0] - zone[i][0], zone[i + 1][1] - zone[i][1]),
    );
    expect(Math.max(...sides)).toBeCloseTo(2.6, 6);
    expect(Math.min(...sides)).toBeCloseTo(0.9, 6);
  });
  it("rejects door clearance, interior wall intersections and invalid transforms", () => {
    expect(code(empty(), { type: "add", object: box(500, 1.8, 1.6) })).toBe(
      "BLOCKS_OPENING",
    );
    const o = box(500, -2.08, 0);
    expect(code(empty(), { type: "add", object: o })).toBe("OUT_OF_BOUNDS");
    const invalid = box();
    invalid.transform.scale[0] = -1;
    expect(code(empty(), { type: "add", object: invalid })).toBe(
      "INVALID_TRANSFORM",
    );
    const tilted = box();
    tilted.transform.rotation = [Math.sin(0.2), 0, 0, Math.cos(0.2)];
    expect(code(empty(), { type: "add", object: tilted })).toBe(
      "INVALID_TRANSFORM",
    );
  });
  it("moves, replaces asset, edits material and deletes without changing identity", () => {
    const o = box(),
      s = { ...empty(), objects: [o] };
    const moved = mustApply(s, {
      type: "move",
      objectId: o.id,
      transform: transformAt(0, 0.4, 0.2),
    });
    expect(moved.objects[0].id).toBe(o.id);
    const replaced = mustApply(moved, {
      type: "replaceAsset",
      objectId: o.id,
      assetId: catalog[2].id,
      dimensionsM: catalog[2].dimensionsM,
    });
    expect(replaced.objects[0].assetId).toBe(catalog[2].id);
    const colored = mustApply(replaced, {
      type: "changeMaterial",
      objectId: o.id,
      overrides: { "*": { colorHex: "#abccde", roughness: 0.3 } },
    });
    expect(colored.objects[0].materialOverrides?.["*"].roughness).toBe(0.3);
    expect(
      mustApply(colored, { type: "delete", objectId: o.id }).objects,
    ).toHaveLength(0);
  });
  it("physical replacement allocates identity and lineage", () => {
    const o = box(),
      s = { ...empty(), objects: [o] },
      replacement = box(501);
    const next = mustApply(s, {
      type: "replacePhysicalItem",
      oldObjectId: o.id,
      newObject: replacement,
    });
    expect(next.objects[0].replacesObjectId).toBe(o.id);
    expect(next.objects[0].id).toBe(replacement.id);
    expect(
      code(s, { type: "replacePhysicalItem", oldObjectId: o.id, newObject: o }),
    ).toBe("DUPLICATE_ID");
  });
});
describe("inverse operations and bounded history", () => {
  const o = box(),
    base = { ...empty(), objects: [o] };
  const operations: SceneOp[] = [
    { type: "add", object: box(501, -1.2, 0) },
    { type: "delete", objectId: o.id },
    { type: "move", objectId: o.id, transform: transformAt(0.3, 0.2, 0.1) },
    {
      type: "changeMaterial",
      objectId: o.id,
      overrides: { "*": { colorHex: "#abcdef" } },
    },
    { type: "setLock", objectId: o.id, locked: true },
    {
      type: "replaceAsset",
      objectId: o.id,
      assetId: catalog[2].id,
      dimensionsM: catalog[2].dimensionsM,
    },
    { type: "replacePhysicalItem", oldObjectId: o.id, newObject: box(501) },
  ];
  it.each(operations)("round trips $type", (op) => {
    const after = mustApply(base, op),
      inverse = invertOp(base, op);
    const restored =
      inverse.type === "checkpoint" ? inverse.scene : mustApply(after, inverse);
    expect({ ...restored, revision: base.revision }).toEqual(base);
  });
  it("inverts visual replacement of an existing GLB", () => {
    const obj = { ...o, assetId: catalog[0].id },
      before = { ...empty(), objects: [obj] },
      op: SceneOp = {
        type: "replaceAsset",
        objectId: obj.id,
        assetId: catalog[2].id,
        dimensionsM: catalog[2].dimensionsM,
      };
    const inverse = invertOp(before, op);
    expect(inverse.type).toBe("replaceAsset");
    if (inverse.type !== "checkpoint")
      expect(mustApply(mustApply(before, op), inverse).objects).toEqual(
        before.objects,
      );
  });
  it("bounds both stacks, preserves object order and clears redo after a new edit", () => {
    let history = createHistory(2),
      scene = base;
    for (let i = 0; i < 3; i++) {
      const op: SceneOp = {
          type: "move",
          objectId: o.id,
          transform: transformAt(i * 0.2, 0),
        },
        after = mustApply(scene, op);
      history = record(history, scene, op, after);
      scene = after;
    }
    expect(history.undo).toHaveLength(2);
    const undone = traverseHistory(scene, history, "undo", ctx);
    expect(undone.ok).toBe(true);
    if (!undone.ok || !undone.history) return;
    expect(undone.history.redo).toHaveLength(1);
    expect(undone.scene.objects[0].transform.position[0]).toBe(0.2);
    const redone = traverseHistory(undone.scene, undone.history, "redo", ctx);
    expect(redone.ok).toBe(true);
    if (redone.ok) expect(redone.scene.objects).toEqual(scene.objects);
    const op: SceneOp = {
      type: "move",
      objectId: o.id,
      transform: transformAt(-0.2, 0),
    };
    expect(
      record(undone.history, undone.scene, op, mustApply(undone.scene, op))
        .redo,
    ).toHaveLength(0);
  });
  it("preserves exact snapshots when undoing deletion from the middle", () => {
    const before = {
      ...base,
      objects: [box(501, -1.2, 0), o, box(502, 1.2, 0)],
    };
    const op: SceneOp = { type: "delete", objectId: o.id },
      after = mustApply(before, op),
      h = record(createHistory(), before, op, after);
    const undo = traverseHistory(after, h, "undo", ctx);
    if (!undo.ok) throw new Error(undo.error.message);
    expect(undo.scene.objects).toEqual(before.objects);
  });
});
