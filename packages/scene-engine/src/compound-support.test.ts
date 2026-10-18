import { describe, expect, it } from "vitest";
import {
  assetById,
  createFixtureScene,
  fixtureId,
  roomShell,
  type SceneObject,
} from "@house/contracts";
import { applyOp, validateObject } from "./operations";
import { resolveDraft } from "./resolve";
import { snapToSurface } from "./support";
const fixture = createFixtureScene();
const ctx = { room: roomShell, assets: assetById };
function model(id: number): SceneObject {
  const o = structuredClone(
    fixture.objects.find((o) => o.id === fixtureId(id))!,
  );
  o.locked = false;
  o.transform.position = [0, 0, 0];
  o.transform.rotation = [0, 0, 0, 1];
  return o;
}
function child(y: number): SceneObject {
  const o = model(111);
  o.dimensionsM = [0.08, 0.1, 0.08];
  o.transform.position[1] = y;
  return o;
}
describe("compound support faces", () => {
  it("snaps onto the actual chair seat below the backrest and preserves it on Accept", () => {
    const chair = model(110),
      item = child(0.5);
    const scene = { ...fixture, objects: [chair, item] };
    const snap = snapToSurface(scene, item, item.transform, roomShell);
    expect(snap.surface?.placement).toEqual({
      support: "object",
      parentId: chair.id,
    });
    expect(snap.transform.position[1]).toBeCloseTo(0.48, 5);
    const moved = applyOp(
      scene,
      { type: "move", objectId: item.id, transform: snap.transform },
      ctx,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(validateObject(moved.scene, moved.scene.objects[1], ctx).ok).toBe(
      true,
    );
    const accepted = resolveDraft(scene, moved.scene, ctx);
    expect(accepted.ok).toBe(true);
    if (accepted.ok)
      expect(accepted.scene.objects[1].transform.position).toEqual(
        snap.transform.position,
      );
  });
  it("does not snap to the empty outer-box top or a covered internal block face", () => {
    const chair = model(110);
    for (const y of [0.82, 0.4]) {
      const item = child(y),
        scene = { ...fixture, objects: [chair, item] };
      expect(
        snapToSurface(scene, item, item.transform, roomShell, 0.015).surface,
      ).toBeUndefined();
      const floating = {
        ...item,
        placement: { support: "object" as const, parentId: chair.id },
      };
      expect(validateObject(scene, floating, ctx).ok).toBe(false);
    }
  });
  it("snaps onto an interior bookshelf shelf instead of its roof", () => {
    const shelf = model(106),
      item = child(0.58);
    const scene = { ...fixture, objects: [shelf, item] };
    const snap = snapToSurface(scene, item, item.transform, roomShell);
    expect(snap.surface?.placement.parentId).toBe(shelf.id);
    expect(snap.transform.position[1]).toBeCloseTo(0.56, 5);
  });
  it("keeps compound contact correct after yaw and scale changes", () => {
    const chair = model(110),
      item = child(0.98);
    chair.transform.rotation = [
      0,
      Math.sin(Math.PI / 8),
      0,
      Math.cos(Math.PI / 8),
    ];
    chair.transform.scale = [1.5, 2, 1.5];
    const snap = snapToSurface(
      { ...fixture, objects: [chair, item] },
      item,
      item.transform,
      roomShell,
    );
    expect(snap.transform.position[1]).toBeCloseTo(0.96, 5);
  });
});
