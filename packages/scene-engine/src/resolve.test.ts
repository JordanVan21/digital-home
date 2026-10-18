import { describe, expect, it } from "vitest";
import {
  assetById,
  createFixtureScene,
  fixtureId,
  roomShell,
  transformAt,
  type SceneObject,
  type SceneSpec,
} from "@house/contracts";
import { applyOp, validateObject, type SceneContext } from "./operations";
import { doorClearances, yawOf } from "./geometry";
import { diffScenes, resolveDraft } from "./resolve";
import { createHistory, recordCheckpoint, traverseHistory } from "./history";

const ctx: SceneContext = {
  room: roomShell,
  assets: assetById,
  roomId: createFixtureScene().roomId,
};
const box = (
  id: number,
  x: number,
  z: number,
  extra: Partial<SceneObject> = {},
): SceneObject => ({
  id: fixtureId(id),
  assetId: null,
  displayName: `Box ${id}`,
  category: "table",
  dimensionsM: [1, 0.5, 1],
  locked: false,
  source: "user",
  placement: { support: "floor" },
  transform: transformAt(x, z, 0),
  ...extra,
});
const sceneOf = (...objects: SceneObject[]): SceneSpec => ({
  ...createFixtureScene(),
  objects,
});
const at = (s: SceneSpec, id: number) =>
  s.objects.find((o) => o.id === fixtureId(id));
const allValid = (s: SceneSpec) =>
  s.objects.every((o) => validateObject(s, o, ctx).ok);

describe("allowConflicts", () => {
  const base = sceneOf(box(1, 0, 0), box(2, 1.5, 0));
  it("permits collisions, out-of-bounds and doorway overlaps", () => {
    const door = doorClearances(roomShell)[0];
    const doorX = door.reduce((s, p) => s + p[0], 0) / door.length;
    const doorZ = door.reduce((s, p) => s + p[1], 0) / door.length;
    for (const [x, z] of [
      [0.4, 0],
      [9, 0],
      [doorX, doorZ],
    ]) {
      const op = {
        type: "move" as const,
        objectId: fixtureId(2),
        transform: transformAt(x, z, 0),
      };
      expect(applyOp(base, op, ctx).ok).toBe(false);
      expect(applyOp(base, op, ctx, { allowConflicts: true }).ok).toBe(true);
    }
  });
  it("still rejects locks, unknown objects and tilted transforms", () => {
    const locked = sceneOf(box(1, 0, 0, { locked: true }));
    const opts = { allowConflicts: true };
    const move = (id: number, t = transformAt(1, 0, 0)) => ({
      type: "move" as const,
      objectId: fixtureId(id),
      transform: t,
    });
    const r1 = applyOp(locked, move(1), ctx, opts);
    expect(!r1.ok && r1.error.code).toBe("OBJECT_LOCKED");
    const r2 = applyOp(locked, move(9), ctx, opts);
    expect(!r2.ok && r2.error.code).toBe("UNKNOWN_OBJECT");
    const lifted = { ...transformAt(0, 0, 0), position: [0, 0.4, 0] };
    const r3 = applyOp(
      sceneOf(box(1, 0, 0)),
      move(1, lifted as never),
      ctx,
      opts,
    );
    expect(r3.ok).toBe(true);
    expect(
      applyOp(sceneOf(box(1, 0, 0)), move(1, lifted as never), ctx).ok,
    ).toBe(false);
  });
});

describe("diffScenes", () => {
  it("classifies untouched, changed, added and removed pieces", () => {
    const accepted = sceneOf(box(1, 0, 0), box(2, 1.5, 0), box(3, -1.5, 0));
    const draft = sceneOf(box(1, 0, 0), box(2, 1.5, 1), box(4, 0, 1.5));
    const d = diffScenes(accepted, draft);
    expect(d.untouched).toEqual([fixtureId(1)]);
    expect(d.changed).toEqual([fixtureId(2)]);
    expect(d.added).toEqual([fixtureId(4)]);
    expect(d.removed).toEqual([fixtureId(3)]);
  });
});

describe("resolveDraft", () => {
  it("applies valid suggestions unchanged", () => {
    const accepted = sceneOf(box(1, 0, 0), box(2, 1.5, 0));
    const draft = sceneOf(box(1, 0, 0), box(2, 1.5, -1));
    const r = resolveDraft(accepted, draft, ctx);
    if (!r.ok) throw new Error("unresolved");
    expect(at(r.scene, 2)?.transform.position).toEqual([1.5, 0, -1]);
    expect(r.report).toEqual([{ objectId: fixtureId(2), outcome: "applied" }]);
    expect(r.scene.revision).toBe(accepted.revision + 1);
  });
  it("moves a colliding piece to the nearest valid spot, keeping rotation, and never moves untouched pieces", () => {
    const accepted = sceneOf(box(1, 0, 0), box(2, 1.5, 0));
    const turned = { ...box(2, 0.6, 0), transform: transformAt(0.6, 0, 0.5) };
    const draft = sceneOf(box(1, 0, 0), turned);
    const r = resolveDraft(accepted, draft, ctx);
    if (!r.ok) throw new Error("unresolved");
    expect(at(r.scene, 1)?.transform).toEqual(at(accepted, 1)?.transform);
    const moved = at(r.scene, 2)!;
    expect(yawOf(moved.transform.rotation)).toBeCloseTo(0.5);
    const entry = r.report.find((e) => e.objectId === fixtureId(2))!;
    expect(entry.outcome).toBe("moved");
    expect(entry.distanceM).toBeGreaterThan(0);
    expect(entry.distanceM).toBeLessThan(1);
    expect(allValid(r.scene)).toBe(true);
  });
  it("reverts a changed piece with no nearby fit, and drops an added one", () => {
    // Fill the room with untouched pieces, leaving only the mover's original spot
    // (back-left corner) free; the doorway area is front-right, out of search range.
    const blockers: SceneObject[] = [];
    let id = 100;
    for (let x = -2; x <= 2; x += 1)
      for (let z = -1.6; z <= 1.6; z += 1.05)
        if (!(x === -2 && z > 1)) {
          const b = box(id++, x, z);
          if (validateObject(sceneOf(), b, ctx).ok) blockers.push(b);
        }
    const mover = box(2, -2, 1.55, {
      dimensionsM: [0.5, 0.5, 0.5],
    });
    const accepted = sceneOf(...blockers, mover);
    const draft = sceneOf(
      ...blockers,
      { ...mover, transform: transformAt(0.1, -1.6, 0) },
      box(3, -1.1, -0.5, { dimensionsM: [0.6, 0.5, 0.6] }),
    );
    expect(allValid(accepted)).toBe(true);
    const r = resolveDraft(accepted, draft, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.unresolved));
    expect(at(r.scene, 2)?.transform).toEqual(mover.transform);
    expect(at(r.scene, 3)).toBeUndefined();
    const outcome = (n: number) =>
      r.report.find((e) => e.objectId === fixtureId(n))?.outcome;
    expect(outcome(2)).toBe("reverted");
    expect(outcome(3)).toBe("dropped");
    expect(allValid(r.scene)).toBe(true);
  });
  it("never moves a locked piece to resolve it; it is reverted", () => {
    const accepted = sceneOf(box(1, 0, 0), box(2, 1.5, 0));
    const draft = sceneOf(box(1, 0, 0), box(2, 0.5, 0, { locked: true }));
    const r = resolveDraft(
      {
        ...accepted,
        objects: [box(1, 0, 0), box(2, 1.5, 0, { locked: true })],
      },
      draft,
      ctx,
    );
    if (!r.ok) throw new Error("unresolved");
    expect(at(r.scene, 2)?.transform.position).toEqual([1.5, 0, 0]);
    expect(r.report[0].outcome).toBe("reverted");
  });
  it("applies removals and lets earlier pieces claim space first", () => {
    const accepted = sceneOf(box(1, 0, 0), box(2, 1.5, 0), box(3, -1.5, 0));
    const draft = sceneOf(box(1, 0, 0), box(2, -1.4, 1.2), box(4, -1.4, 1.2));
    const r = resolveDraft(accepted, draft, ctx);
    if (!r.ok) throw new Error("unresolved");
    expect(at(r.scene, 3)).toBeUndefined();
    expect(at(r.scene, 2)?.transform.position).toEqual([-1.4, 0, 1.2]);
    const entry4 = r.report.find((e) => e.objectId === fixtureId(4))!;
    expect(entry4.outcome).toBe("moved");
    expect(r.report.find((e) => e.objectId === fixtureId(3))?.outcome).toBe(
      "removed",
    );
    expect(allValid(r.scene)).toBe(true);
  });
  it("lets rugs overlap furniture without being moved", () => {
    const rug = box(5, 0, 0, { category: "rug", dimensionsM: [2, 0.02, 1.5] });
    const accepted = sceneOf(box(1, 0, 0), {
      ...rug,
      transform: transformAt(1.4, 1, 0),
    });
    const draft = sceneOf(box(1, 0, 0), rug);
    const r = resolveDraft(accepted, draft, ctx);
    if (!r.ok) throw new Error("unresolved");
    expect(r.report[0].outcome).toBe("applied");
  });
  it("reports unresolved pieces and commits nothing when even reverting fails", () => {
    // Piece 2 moves away; added piece 3 claims piece 2's old spot exactly; piece 2's
    // new spot is out of the room with no fit nearby, so its revert target is taken.
    const accepted = sceneOf(box(2, 1.5, 0));
    const draft = sceneOf(box(3, 1.5, 0), {
      ...box(2, 1.5, 0),
      transform: transformAt(30, 30, 0),
    });
    const r = resolveDraft(accepted, draft, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unresolved.map((u) => u.objectId)).toEqual([fixtureId(2)]);
  });
});

describe("recordCheckpoint", () => {
  it("undoes and redoes a whole accepted batch as one entry", () => {
    const before = sceneOf(box(1, 0, 0), box(2, 1.5, 0));
    const after = { ...sceneOf(box(1, 0, -1), box(4, -1.5, 0)), revision: 1 };
    let history = recordCheckpoint(createHistory(), before, after);
    expect(history.undo).toHaveLength(1);
    const undone = traverseHistory(after, history, "undo", ctx);
    if (!undone.ok) throw new Error("undo failed");
    expect(undone.scene.objects).toEqual(before.objects);
    history = undone.history!;
    const redone = traverseHistory(undone.scene, history, "redo", ctx);
    if (!redone.ok) throw new Error("redo failed");
    expect(redone.scene.objects).toEqual(after.objects);
  });
});

describe("supported height editing", () => {
  const table = box(700, 0, 0, { dimensionsM: [1.5, 0.7, 1.5] });
  const small = box(701, 1.5, 0, { dimensionsM: [0.3, 0.2, 0.3] });
  it("snaps a raised draft to a containing tabletop, records support and validates the result", () => {
    const base = sceneOf(table, small);
    const lifted = { ...small, transform: transformAt(0, 0, 0, 0.8) };
    const r = resolveDraft(base, sceneOf(table, lifted), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(at(r.scene, 701)!.transform.position).toEqual([0, 0.7, 0]);
    expect(at(r.scene, 701)!.placement).toEqual({
      support: "object",
      parentId: table.id,
    });
    expect(allValid(r.scene)).toBe(true);
    expect(r.report.find((e) => e.objectId === small.id)!.outcome).toBe(
      "moved",
    );
  });
  it("settles an unsupported raised draft back to the floor", () => {
    const r = resolveDraft(
      sceneOf(small),
      sceneOf({ ...small, transform: transformAt(1.5, 0, 0, 1) }),
      ctx,
    );
    expect(r.ok && at(r.scene, 701)!.transform.position[1]).toBe(0);
  });
  it("rejects floating, off-center, intersecting, and above-ceiling accepted states", () => {
    const supported = {
      ...small,
      placement: { support: "object" as const, parentId: table.id },
      transform: transformAt(0, 0, 0, 0.7),
    };
    const scene = sceneOf(table, supported);
    expect(validateObject(scene, supported, ctx).ok).toBe(true);
    for (const transform of [
      transformAt(0, 0, 0, 0.8),
      transformAt(0.8, 0, 0, 0.7),
      transformAt(0, 0, 0, 0.6),
      transformAt(0, 0, 0, 3),
    ])
      expect(validateObject(scene, { ...supported, transform }, ctx).ok).toBe(
        false,
      );
  });
  it("does not move untouched supported pieces when their support moves", () => {
    const supported = {
      ...small,
      placement: { support: "object" as const, parentId: table.id },
      transform: transformAt(0, 0, 0, 0.7),
    };
    const r = resolveDraft(
      sceneOf(table, supported),
      sceneOf({ ...table, transform: transformAt(-1.5, 0, 0) }, supported),
      ctx,
    );
    expect(r.ok).toBe(false);
  });
  it("rejects cyclic supports and carries children during direct support moves", () => {
    const supported = {
      ...small,
      placement: { support: "object" as const, parentId: table.id },
      transform: transformAt(0, 0, 0, 0.7),
    };
    const base = sceneOf(table, supported);
    const cycle = {
      ...table,
      placement: { support: "object" as const, parentId: supported.id },
    };
    expect(validateObject(base, cycle, ctx, { allowConflicts: true }).ok).toBe(
      false,
    );
    expect(
      applyOp(
        base,
        {
          type: "move",
          objectId: table.id,
          transform: transformAt(-1.5, 0, 0),
        },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      applyOp(
        base,
        {
          type: "move",
          objectId: table.id,
          transform: transformAt(-1.5, 0, 0),
        },
        ctx,
        { allowConflicts: true },
      ).ok,
    ).toBe(true);
  });
});
