import { describe, expect, it } from "vitest";
import {
  assetById,
  createFixtureScene,
  fixtureId,
  roomShell,
  transformAt,
  type SceneObject,
} from "@house/contracts";
import { applyOp, validateOp } from "./operations";
import { resolveDraft } from "./resolve";
import { snapToSurface, topY } from "./support";

const ctx = { room: roomShell, assets: assetById };
const base = createFixtureScene();
const table = base.objects.find((o) => o.category === "coffee-table")!;
const small = base.objects.find((o) => o.id === fixtureId(111))!;
const scene = { ...base, objects: [table, small] };
const at = (x: number, y: number, z: number) => ({
  ...small.transform,
  position: [x, y, z] as [number, number, number],
});
describe("surface contact", () => {
  it("magnetically lands exactly on the floor and ignores distant free heights", () => {
    const snapped = snapToSurface(scene, small, at(0.2, 0.04, 1.75), roomShell);
    expect(snapped.transform.position[1]).toBe(0);
    expect(snapped.surface?.label).toBe("Floor");
    expect(
      snapToSurface(scene, small, at(0.2, 0.4, 1.75), roomShell).surface,
    ).toBeUndefined();
  });
  it("aligns the bottom face to a tabletop and move validation recognizes contact immediately", () => {
    const [x, , z] = table.transform.position;
    const snapped = snapToSurface(
      scene,
      small,
      at(x, topY(table) + 0.03, z),
      roomShell,
    );
    expect(snapped.transform.position[1]).toBe(topY(table));
    const op = {
      type: "move" as const,
      objectId: small.id,
      transform: snapped.transform,
    };
    expect(validateOp(scene, op, ctx).ok).toBe(true);
    const result = applyOp(scene, op, ctx);
    expect(
      result.ok &&
        result.scene.objects.find((o) => o.id === small.id)!.placement,
    ).toEqual({ support: "object", parentId: table.id });
    if (!result.ok) return;
    const accepted = resolveDraft(scene, result.scene, ctx);
    expect(
      accepted.ok &&
        accepted.scene.objects.find((o) => o.id === small.id)!.transform
          .position,
    ).toEqual(snapped.transform.position);
  });
  it("supports the fixture plant despite leafy bounding-box overhang", () => {
    const plant = base.objects.find((o) => o.category === "plant")!;
    const [x, , z] = table.transform.position;
    const candidate = {
      ...plant,
      transform: {
        ...plant.transform,
        position: [x, topY(table), z] as [number, number, number],
      },
    };
    const state = { ...base, objects: [table, plant] };
    expect(
      validateOp(
        state,
        { type: "move", objectId: plant.id, transform: candidate.transform },
        ctx,
      ).ok,
    ).toBe(true);
  });
  it.each(["sofa", "armchair", "chair", "plant", "rug", "custom-object"])(
    "supports stacking on %s boxes without category rules",
    (category) => {
      const fixture =
        base.objects.find((o) => o.category === category) ?? table;
      const parent: SceneObject = {
        ...fixture,
        category,
        transform: transformAt(0, 0),
      };
      const state = { ...base, objects: [parent, small] };
      const snapped = snapToSurface(
        state,
        small,
        at(0, topY(parent) + 0.03, 0),
        roomShell,
      );
      expect(snapped.surface?.key).toBe(parent.id);
      expect(snapped.transform.position[1]).toBe(topY(parent));
      const result = applyOp(
        state,
        { type: "move", objectId: small.id, transform: snapped.transform },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.scene.objects.find((o) => o.id === small.id)!.placement,
      ).toEqual({ support: "object", parentId: parent.id });
      const accepted = resolveDraft(state, result.scene, ctx);
      expect(accepted.ok).toBe(true);
      if (accepted.ok)
        expect(
          accepted.scene.objects.find((o) => o.id === small.id)!.transform
            .position,
        ).toEqual(snapped.transform.position);
    },
  );
  it("keeps contacts correct on rotated and scaled supports", () => {
    const parent: SceneObject = {
      ...table,
      transform: { ...transformAt(0, 0, Math.PI / 4), scale: [1.2, 2, 1.2] },
    };
    const snapped = snapToSurface(
      { ...scene, objects: [parent, small] },
      small,
      at(0, topY(parent) + 0.05, 0),
      roomShell,
    );
    expect(snapped.transform.position[1]).toBe(topY(parent));
  });
  it("resolves a moved parent before its snapped child even in reverse array order", () => {
    const parent = { ...table, transform: transformAt(0, -0.5) };
    const child = {
      ...small,
      placement: { support: "object" as const, parentId: parent.id },
      transform: at(0, topY(parent), -0.5),
    };
    const result = resolveDraft(
      scene,
      { ...scene, objects: [child, parent] },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.scene.objects.find((o) => o.id === small.id)!.transform.position,
      ).toEqual(child.transform.position);
  });
});
