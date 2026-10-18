import { describe, expect, it } from "vitest";
import {
  OpeningSchema,
  RoomFixtureSchema,
  ScanFixtureSchema,
  SceneObjectSchema,
  SceneSpecSchema,
} from "./schemas";
import { fixtureId, fixtureScene, roomShell } from "./fixtures";

const object = fixtureScene.objects[0];
describe("additive contract fields from Jordan's sandbox", () => {
  it("accepts doorless openings, door swing and glazing", () => {
    const base = roomShell.openings[0];
    expect(OpeningSchema.parse({ ...base, kind: "opening" }).kind).toBe(
      "opening",
    );
    const glazed = OpeningSchema.parse({
      ...base,
      swing: "left",
      glazing: { panels: 3, frameColor: "#2b2520" },
    });
    expect(glazed.glazing?.panels).toBe(3);
    expect(
      OpeningSchema.safeParse({ ...base, glazing: { panels: 0 } }).success,
    ).toBe(false);
    expect(OpeningSchema.safeParse({ ...base, swing: "up" }).success).toBe(
      false,
    );
  });
  it("keeps tilt and scan provenance on objects", () => {
    const tilted = SceneObjectSchema.parse({ ...object, tilt: { x: 1, z: 0 } });
    expect(tilted.tilt).toEqual({ x: 1, z: 0 });
    expect(
      SceneObjectSchema.safeParse({ ...object, tilt: { x: 4, z: 0 } }).success,
    ).toBe(false);
    expect(
      SceneObjectSchema.safeParse({ ...object, tilt: { x: 0.5, z: 0 } })
        .success,
    ).toBe(false);
    const scanned = SceneObjectSchema.parse({
      ...object,
      scanMatch: {
        roomPlanCategory: "sofa",
        scanDimensionsM: [1.6, 0.8, 0.68],
        score: 0.91,
      },
    });
    expect(scanned.scanMatch?.score).toBe(0.91);
  });
  it("keeps per-scene appearance and still parses scenes without it", () => {
    const painted = SceneSpecSchema.parse({
      ...fixtureScene,
      appearance: { wallColor: "#efe6da", floorMaterial: "honey" },
    });
    expect(painted.appearance?.floorMaterial).toBe("honey");
    expect(SceneSpecSchema.parse(fixtureScene)).toEqual(fixtureScene);
  });
  it("parses room and scan fixtures", () => {
    const room = RoomFixtureSchema.parse({
      schemaVersion: 1,
      name: "Living room",
      shell: roomShell,
      scene: fixtureScene,
      photoCamera: { position: [1, 2, 3], target: [0, 1, 0], fov: 40 },
    });
    expect(room.photoCamera?.fov).toBe(40);
    const scan = ScanFixtureSchema.parse({
      schemaVersion: 1,
      name: "Scan",
      roomId: fixtureId(4),
      shell: roomShell,
      scanObjects: [
        {
          scanObjectId: fixtureId(700),
          category: "table",
          dimensionsM: [1, 0.4, 0.6],
          transform: object.transform,
        },
      ],
    });
    expect(scan.scanObjects).toHaveLength(1);
  });
});
