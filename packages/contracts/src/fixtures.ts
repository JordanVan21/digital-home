import {
  AssetSpecSchema,
  type RoomShell,
  type SceneObject,
  type SceneSpec,
  type Transform,
  type Vec3,
} from "./schemas";
import catalogJson from "./catalog.json";

export const fixtureId = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const catalog = AssetSpecSchema.array().parse(catalogJson);
export const assetById = Object.fromEntries(catalog.map((a) => [a.id, a]));
export const roomShell: RoomShell = {
  id: fixtureId(1),
  sourceScanId: fixtureId(2),
  coordinateVersion: 1,
  ceilingHeightM: 2.6,
  floor: {
    polygonXZ: [
      [-2.6, -2.2],
      [2.6, -2.2],
      [2.6, 2.2],
      [-2.6, 2.2],
    ],
    elevationY: 0,
  },
  walls: [
    {
      id: fixtureId(10),
      fromXZ: [-2.6, -2.2],
      toXZ: [2.6, -2.2],
      heightM: 2.6,
      thicknessM: 0.12,
    },
    {
      id: fixtureId(11),
      fromXZ: [2.6, -2.2],
      toXZ: [2.6, 2.2],
      heightM: 2.6,
      thicknessM: 0.12,
    },
    {
      id: fixtureId(12),
      fromXZ: [2.6, 2.2],
      toXZ: [-2.6, 2.2],
      heightM: 2.6,
      thicknessM: 0.12,
    },
    {
      id: fixtureId(13),
      fromXZ: [-2.6, 2.2],
      toXZ: [-2.6, -2.2],
      heightM: 2.6,
      thicknessM: 0.12,
    },
  ],
  openings: [
    {
      id: fixtureId(20),
      wallId: fixtureId(12),
      kind: "door",
      offsetM: 0.35,
      widthM: 0.9,
      bottomM: 0,
      heightM: 2.15,
    },
    {
      id: fixtureId(21),
      wallId: fixtureId(13),
      kind: "window",
      offsetM: 1.2,
      widthM: 2.4,
      bottomM: 0.12,
      heightM: 2.1,
    },
    {
      id: fixtureId(22),
      wallId: fixtureId(10),
      kind: "window",
      offsetM: 3.35,
      widthM: 1.25,
      bottomM: 1.1,
      heightM: 1.1,
    },
  ],
};
export const transformAt = (
  x: number,
  z: number,
  yaw = 0,
  y = 0,
): Transform => ({
  position: [x, y, z],
  rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  scale: [1, 1, 1],
});
function object(
  n: number,
  slug: string,
  x: number,
  z: number,
  yaw = 0,
  locked = false,
): SceneObject {
  const a = catalog.find((a) => a.glbStorageKey === `/models/${slug}.glb`);
  if (!a) throw new Error(`Missing fixture asset: ${slug}`);
  return {
    id: fixtureId(100 + n),
    assetId: a.id,
    category: a.category,
    displayName: a.title,
    dimensionsM: [...a.dimensionsM],
    transform: transformAt(x, z, yaw),
    locked,
    source: "catalog",
    ownership: "existing",
    placement: { support: "floor" },
  };
}
export function createFixtureScene(): SceneSpec {
  // Deliberate breathing room between every floor footprint, including the door.
  const objects: SceneObject[] = [
    object(0, "sofa", -0.5, -0.38),
    object(1, "armchair", -0.88, 1.34, Math.PI),
    object(2, "coffee-table", -0.55, 0.58),
    object(3, "rug", -0.5, 0.48),
    object(4, "floor-lamp", -1.98, -0.6),
    object(5, "sideboard", -0.65, -1.88),
    object(6, "bookshelf", 2.08, -1.91),
    object(7, "olive-tree", -2.12, -1.72),
    object(8, "olive-tree", -2.12, 1.55),
    object(9, "desk", 2.13, -0.45, -Math.PI / 2, true),
    object(10, "desk-chair", 1.35, -0.45, Math.PI / 2),
    {
      id: fixtureId(111),
      assetId: null,
      category: "side-table",
      displayName: "Scanned side table",
      dimensionsM: [0.36, 0.48, 0.36] as Vec3,
      transform: transformAt(0.2, 1.75),
      locked: false,
      source: "roomplan_approximation",
      placement: { support: "floor" },
    },
  ];
  return {
    schemaVersion: 1,
    id: fixtureId(3),
    roomId: fixtureId(4),
    shellId: roomShell.id,
    revision: 0,
    objects,
    lightingPreset: "golden-hour",
    updatedAt: "2026-10-17T00:00:00.000Z",
  };
}
export const fixtureScene = createFixtureScene();
