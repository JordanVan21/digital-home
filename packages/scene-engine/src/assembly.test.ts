import { describe, expect, it } from "vitest";
import {
  assetById,
  createFixtureScene,
  fixtureId,
  roomShell,
  type SceneObject,
} from "@house/contracts";
import { applyOp, validateOp } from "./operations";
import { resolveDraft } from "./resolve";
import { objectsCollide } from "./collision";
const fixture = createFixtureScene();
const ctx = { room: roomShell, assets: assetById };
function box(
  id: number,
  position: [number, number, number],
  dimensions: [number, number, number],
  parent?: string,
): SceneObject {
  return {
    ...structuredClone(fixture.objects.find((o) => o.id === fixtureId(111))!),
    id: fixtureId(id),
    displayName: `Box ${id}`,
    dimensionsM: dimensions,
    transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    placement: parent
      ? { support: "object", parentId: parent }
      : { support: "floor" },
  };
}
const parent = box(800, [0, 0, 0], [1, 0.6, 1]);
const child = box(801, [0.2, 0.6, 0], [0.2, 0.2, 0.2], parent.id);
const grandchild = box(802, [0.2, 0.8, 0], [0.1, 0.1, 0.1], child.id);
const base = () => ({
  ...fixture,
  objects: structuredClone([parent, child, grandchild]),
});
const move = (position: [number, number, number], yaw = 0) => ({
  type: "move" as const,
  objectId: parent.id,
  transform: {
    ...parent.transform,
    position,
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as [
      number,
      number,
      number,
      number,
    ],
  },
});
describe("moving snapped assemblies", () => {
  it("moves a support and every descendant in a single pure operation", () => {
    const scene = base(),
      result = applyOp(scene, move([0.5, 0, -0.5]), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects[1].transform.position).toEqual([
      0.7, 0.6, -0.5,
    ]);
    expect(result.scene.objects[2].transform.position).toEqual([
      0.7, 0.8, -0.5,
    ]);
    expect(scene.objects[1].transform.position).toEqual(
      child.transform.position,
    );
  });
  it("rotates attached items around their support, retaining their local offsets", () => {
    const result = applyOp(base(), move([0, 0, 0], Math.PI / 2), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects[1].transform.position[0]).toBeCloseTo(0);
    expect(result.scene.objects[1].transform.position[2]).toBeCloseTo(-0.2);
    expect(result.scene.objects[1].transform.rotation[1]).toBeCloseTo(
      Math.sin(Math.PI / 4),
    );
    expect(result.scene.objects[1].transform.rotation[3]).toBeCloseTo(
      Math.cos(Math.PI / 4),
    );
  });
  it("moving a child detaches it without moving its parent, and carries its own children", () => {
    const result = applyOp(
      base(),
      {
        type: "move",
        objectId: child.id,
        transform: { ...child.transform, position: [1.5, 0, 0] },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects[0]).toEqual(parent);
    expect(result.scene.objects[1].placement).toEqual({ support: "floor" });
    expect(result.scene.objects[2].transform.position).toEqual([
      1.5,
      expect.closeTo(0.2),
      0,
    ]);
  });
  it("blocks moving a locked descendant, including conflict-permissive drafts", () => {
    const scene = base();
    scene.objects[2].locked = true;
    for (const options of [{}, { allowConflicts: true }])
      expect(validateOp(scene, move([0.5, 0, 0]), ctx, options)).toMatchObject({
        ok: false,
        error: { code: "OBJECT_LOCKED", objectId: grandchild.id },
      });
  });
  it("checks carried children against outside obstacles even when the support clears them", () => {
    const scene = base();
    // The child overhangs 5 cm; the obstacle clears the parent by 5 mm.
    scene.objects[1].transform.position[0] = 0.45;
    scene.objects[2].transform.position[0] = 0.45;
    scene.objects.push(box(803, [1.08, 0, 0], [0.15, 1, 0.15]));
    const draft = applyOp(scene, move([0.5, 0, 0]), ctx, {
      allowConflicts: true,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(
      objectsCollide(draft.scene.objects[0], draft.scene.objects[3], assetById),
    ).toBe(false);
    expect(
      objectsCollide(draft.scene.objects[1], draft.scene.objects[3], assetById),
    ).toBe(true);
    expect(validateOp(scene, move([0.5, 0, 0]), ctx)).toMatchObject({
      ok: false,
      error: { code: "COLLISION" },
    });
  });
  it("carries vertical movement and uniform scale in drafts, while blocking unsupported acceptance", () => {
    const op = move([0, 0.3, 0]);
    op.transform.scale = [1.5, 1.5, 1.5];
    const draft = applyOp(base(), op, ctx, { allowConflicts: true });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.scene.objects[1].transform.position[0]).toBeCloseTo(0.3);
    expect(draft.scene.objects[1].transform.position[1]).toBeCloseTo(1.2);
    expect(draft.scene.objects[1].transform.scale).toEqual([1.5, 1.5, 1.5]);
    expect(validateOp(base(), op, ctx)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SUPPORT" },
    });
    const accepted = resolveDraft(base(), draft.scene, ctx);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.scene.objects[0].transform.position[1]).toBe(0);
    expect(accepted.scene.objects[1].transform.position[1]).toBeCloseTo(0.9);
  });
  it("excludes descendants as snap targets and never groups nearby unattached objects", () => {
    const scene = base(),
      unrelated = box(805, [1.5, 0, 0], [0.1, 0.1, 0.1]);
    scene.objects.push(unrelated);
    const result = applyOp(scene, move([0.2, 0, 0]), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.objects[0].placement).toEqual({ support: "floor" });
    expect(result.scene.objects[3]).toBe(unrelated);
  });
  it("resolves a conflicted stack as a unit without separating its snapped contacts", () => {
    const scene = base();
    scene.objects.push(box(803, [1, 0, 0], [0.4, 1, 0.4]));
    const draft = applyOp(scene, move([1, 0, 0]), ctx, {
      allowConflicts: true,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const result = resolveDraft(scene, draft.scene, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [p, c, g, obstacle] = result.scene.objects;
    expect(c.transform.position[0] - p.transform.position[0]).toBeCloseTo(0.2);
    expect(c.transform.position[1] - p.transform.position[1]).toBeCloseTo(0.6);
    expect(g.transform.position[1] - c.transform.position[1]).toBeCloseTo(0.2);
    expect(c.placement?.parentId).toBe(p.id);
    expect(g.placement?.parentId).toBe(c.id);
    expect(objectsCollide(p, obstacle, assetById)).toBe(false);
  });
});
