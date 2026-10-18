import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assetById,
  catalog,
  createFixtureScene,
  fixtureId,
  roomShell,
  type SceneObject,
} from "@house/contracts";
import { collisionReference } from "./collisionReference.test-utils";
import profiles from "./colliderProfiles.json";
import { objectsCollide } from "./collision";
import { footprint, overlaps } from "./geometry";
import { validateObject } from "./operations";
import { resolveDraft } from "./resolve";
const fixture = createFixtureScene();
function piece(id: number, x = 0, y = 0, z = 0, yaw = 0): SceneObject {
  const o = structuredClone(
    fixture.objects.find((o) => o.id === fixtureId(id))!,
  );
  o.locked = false;
  o.transform.position = [x, y, z];
  o.transform.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  return o;
}
const ctx = { room: roomShell, assets: assetById, roomId: fixture.roomId };
describe("compound object collisions", () => {
  it("ships finite, bounded, nonempty profiles matching the catalog hashes", () => {
    for (const [id, profile] of Object.entries(profiles)) {
      expect(profile.contentHash).toBe(assetById[id].contentHash);
      expect(profile.boxes.length).toBeGreaterThan(0);
      for (const [min, max] of profile.boxes) {
        for (let axis = 0; axis < 3; axis++) {
          expect(Number.isFinite(min[axis]) && Number.isFinite(max[axis])).toBe(
            true,
          );
          expect(min[axis]).toBeGreaterThanOrEqual(0);
          expect(max[axis]).toBeLessThanOrEqual(1);
          expect(max[axis]).toBeGreaterThan(min[axis]);
        }
      }
    }
  });
  it("bakes a profile for every opaque catalog model; alpha models keep boxes", () => {
    for (const asset of catalog) {
      const glb = readFileSync(
        `apps/web/public${asset.glbStorageKey}`,
      ) as Buffer;
      const json = JSON.parse(
        glb.subarray(20, 20 + glb.readUInt32LE(12)).toString(),
      ) as { materials?: { alphaMode?: string }[] };
      const opaque = (json.materials ?? []).every(
        (m) => (m.alphaMode ?? "OPAQUE") === "OPAQUE",
      );
      expect(asset.id in profiles, asset.title).toBe(opaque);
    }
  });
  it("allows the real chair partly under the desk, with the same result on Accept", () => {
    const desk = piece(109);
    const chair = piece(110);
    const tucked = piece(110, 0, 0, 0.5, Math.PI);
    expect(overlaps(footprint(desk), footprint(tucked))).toBe(true);
    expect(objectsCollide(desk, tucked, assetById)).toBe(false);
    const scene = { ...fixture, objects: [desk, tucked] };
    expect(validateObject(scene, tucked, ctx)).toEqual({ ok: true });
    expect(objectsCollide(desk, chair, assetById)).toBe(true);
    expect(
      validateObject({ ...scene, objects: [desk, chair] }, chair, ctx),
    ).toMatchObject({ ok: false, error: { code: "COLLISION" } });
    // Resolver must preserve a feasible tucked placement rather than move it out.
    const before = { ...fixture, objects: [desk, piece(110, 0, 0, 1)] };
    const result = resolveDraft(before, scene, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Tucked layout rejected");
    expect(
      result.scene.objects.find((o) => o.id === tucked.id)?.transform,
    ).toEqual(tucked.transform);
  });
  it("allows a low object fully inside the desktop footprint without treating the air as solid", () => {
    const desk = piece(109);
    const stool = piece(111);
    stool.dimensionsM = [0.2, 0.3, 0.2];
    expect(overlaps(footprint(desk), footprint(stool))).toBe(true);
    expect(objectsCollide(desk, stool, assetById)).toBe(false);
    stool.transform.position[1] = 0.65;
    expect(objectsCollide(desk, stool, assetById)).toBe(true);
  });
  it("preserves tight proxy contact and rejects solid containment", () => {
    const a = piece(111);
    a.dimensionsM = [1, 1, 1];
    const b = piece(111, 1);
    b.id = fixtureId(990);
    b.dimensionsM = [1, 1, 1];
    expect(objectsCollide(a, b, assetById)).toBe(false);
    b.transform.position[0] = 0.999;
    expect(objectsCollide(a, b, assetById)).toBe(true);
    b.dimensionsM = [0.1, 0.1, 0.1];
    b.transform.position = [0, 0.2, 0];
    expect(objectsCollide(a, b, assetById)).toBe(true);
  });
  it("handles yaw, scaling and stale asset hashes conservatively", () => {
    const desk = piece(109, 0, 0, 0, Math.PI / 2);
    const chair = piece(110, 0, 0, 0, Math.PI / 2);
    desk.transform.scale = [1.2, 1.2, 1.2];
    chair.transform.scale = [1.2, 1.2, 1.2];
    expect(objectsCollide(desk, chair, assetById)).toBe(true);
    const assets = {
      ...assetById,
      [desk.assetId!]: { ...assetById[desk.assetId!], contentHash: "stale" },
    };
    expect(objectsCollide(desk, chair, assets)).toBe(true);
  });
});

describe("collision hierarchy", () => {
  it("matches linear checks across deterministic asset pairs, yaw, scale, heights and both query orders", () => {
    let seed = 123456;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const all = fixture.objects;
    for (let i = 0; i < 256; i++) {
      const pair = [0, 1].map(() => {
        const o = structuredClone(all[Math.floor(random() * all.length)]);
        const yaw = random() * Math.PI * 2;
        o.transform = {
          position: [
            random() * 1.4 - 0.7,
            random() * 0.8,
            random() * 1.4 - 0.7,
          ],
          rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
          scale: [0.5 + random(), 0.5 + random(), 0.5 + random()],
        };
        return o;
      });
      const expected = collisionReference(pair[0], pair[1], assetById);
      expect(objectsCollide(pair[0], pair[1], assetById), `sample ${i}`).toBe(
        expected,
      );
      expect(
        objectsCollide(pair[1], pair[0], assetById),
        `reverse sample ${i}`,
      ).toBe(expected);
    }
  });
  it("prunes occupied-box comparisons while retaining the real chair-under-desk gap", () => {
    const desk = piece(109),
      chair = piece(110, 0, 0, 0.5, Math.PI);
    const linear = { boxPairs: 0 },
      hierarchy = { nodePairs: 0, boxPairs: 0 };
    expect(collisionReference(desk, chair, assetById, linear)).toBe(false);
    expect(objectsCollide(desk, chair, assetById, hierarchy)).toBe(false);
    expect(hierarchy.boxPairs).toBeLessThan(linear.boxPairs / 4);
    console.log("Desk/chair comparisons", {
      linear: linear.boxPairs,
      ...hierarchy,
    });
  });
});

it("rejects the walnut coffee table fully hidden inside the couch body, including rotated/scaled placements", () => {
  for (const yaw of [0, Math.PI / 3]) {
    const sofa = piece(100, 0, 0, 0, yaw),
      table = piece(102, 0, 0, 0, yaw);
    sofa.transform.scale = [1.1, 1.1, 1.1];
    table.transform.scale = [1.1, 1.1, 1.1];
    expect(objectsCollide(sofa, table, assetById)).toBe(true);
    const scene = { ...fixture, objects: [sofa, table] };
    expect(validateObject(scene, table, ctx)).toMatchObject({
      ok: false,
      error: { code: "COLLISION" },
    });
    const before = { ...scene, objects: [sofa, piece(102, 0, 0, 1.5, yaw)] };
    const result = resolveDraft(before, scene, ctx);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        objectsCollide(
          result.scene.objects[0],
          result.scene.objects[1],
          assetById,
        ),
      ).toBe(false);
  }
});
