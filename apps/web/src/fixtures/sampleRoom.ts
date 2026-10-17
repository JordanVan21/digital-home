import type { RoomShell, SceneObject, SceneSpec } from "@house/contracts";
import { fixtureAsset } from "./assetCatalog";

/**
 * Standalone demo fixture standing in for a RoomPlan scan import, until the
 * real scan pipeline (apps/worker) exists. A roughly 5.2m x 4.2m living
 * room with a full-height glass opening on the west wall, modeled after
 * assets/test2.png.
 */

const roomId = crypto.randomUUID();
const shellId = crypto.randomUUID();
const sceneId = crypto.randomUUID();
const scanId = crypto.randomUUID();

const wallWest = crypto.randomUUID();
const wallNorth = crypto.randomUUID();
const wallEast = crypto.randomUUID();
const wallSouth = crypto.randomUUID();

export const sampleRoomShell: RoomShell = {
  id: shellId,
  sourceScanId: scanId,
  coordinateVersion: 1,
  floor: {
    polygonXZ: [
      [0, 0],
      [5.2, 0],
      [5.2, 4.2],
      [0, 4.2],
    ],
    elevationY: 0,
  },
  walls: [
    { id: wallSouth, fromXZ: [0, 0], toXZ: [5.2, 0], heightM: 2.7, thicknessM: 0.12 },
    { id: wallEast, fromXZ: [5.2, 0], toXZ: [5.2, 4.2], heightM: 2.7, thicknessM: 0.12 },
    { id: wallNorth, fromXZ: [5.2, 4.2], toXZ: [0, 4.2], heightM: 2.7, thicknessM: 0.12 },
    { id: wallWest, fromXZ: [0, 4.2], toXZ: [0, 0], heightM: 2.7, thicknessM: 0.12 },
  ],
  openings: [
    {
      id: crypto.randomUUID(),
      wallId: wallWest,
      kind: "window",
      offsetM: 0.4,
      widthM: 2.6,
      bottomM: 0,
      heightM: 2.4,
    },
    {
      id: crypto.randomUUID(),
      wallId: wallSouth,
      kind: "door",
      offsetM: 4.0,
      widthM: 0.9,
      bottomM: 0,
      heightM: 2.1,
    },
  ],
  ceilingHeightM: 2.7,
};

function obj(partial: Omit<SceneObject, "assetId" | "source" | "ownership">): SceneObject {
  const asset = fixtureAsset(partial.category);
  const fit = asset ? Math.min(...partial.dimensionsM.map((n, i) => n / asset.dimensionsM[i])) : 1;
  return {
    assetId: asset?.id ?? null,
    source: "roomplan_approximation",
    ownership: "existing",
    ...partial,
    // Fit the existing scan envelope uniformly, preserving artist proportions.
    // Keep collision/selection dimensions equal to the actual rendered model.
    ...(asset ? {
      dimensionsM: asset.dimensionsM.map((n) => n * fit) as SceneObject["dimensionsM"],
      displayName: asset.title.replace(/ \d+$/, ""),
    } : {}),
  };
}

export const sampleObjects: SceneObject[] = [
  obj({
    id: crypto.randomUUID(),
    category: "sofa",
    displayName: "Cream sectional sofa",
    transform: { position: [2.95, 0, 3.35], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    dimensionsM: [2.2, 0.85, 0.95],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "rug",
    displayName: "Woven jute rug",
    transform: { position: [2.5, 0, 2.5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    dimensionsM: [2.6, 0.02, 1.9],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "coffee_table",
    displayName: "Round marble coffee table",
    transform: { position: [2.5, 0, 2.25], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    dimensionsM: [0.9, 0.34, 0.9],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "armchair",
    displayName: "Boucle swivel chair",
    transform: { position: [1.5, 0, 1.3], rotation: [0, 0.38, 0, 0.92], scale: [1, 1, 1] },
    dimensionsM: [0.85, 0.75, 0.85],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "floor_lamp",
    displayName: "Arc floor lamp",
    transform: { position: [4.4, 0, 3.0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    dimensionsM: [0.45, 1.55, 0.45],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "bookshelf",
    displayName: "Walnut bookshelf",
    transform: { position: [4.95, 0, 3.55], rotation: [0, -0.7, 0, 0.71], scale: [1, 1, 1] },
    dimensionsM: [0.9, 1.8, 0.3],
    locked: false,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "credenza",
    displayName: "Walnut credenza",
    transform: { position: [4.85, 0, 1.6], rotation: [0, -0.7, 0, 0.71], scale: [1, 1, 1] },
    dimensionsM: [1.4, 0.72, 0.4],
    locked: true,
    placement: { support: "floor" },
  }),
  obj({
    id: crypto.randomUUID(),
    category: "plant",
    displayName: "Potted monstera",
    transform: { position: [0.7, 0, 0.7], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    dimensionsM: [0.5, 1.3, 0.5],
    locked: false,
    placement: { support: "floor" },
  }),
];

export const sampleScene: SceneSpec = {
  schemaVersion: 1,
  id: sceneId,
  roomId,
  shellId,
  revision: 0,
  objects: sampleObjects,
  lightingPreset: "golden_hour",
  updatedAt: new Date().toISOString(),
};
