import { assetById, type AssetSpec } from "@house/contracts";
import { COLLISION_TOLERANCE_M, objectsCollide } from "./collision";
import { topContactFaces, bottomContactFaces } from "./contactFaces";
import type {
  RoomShell,
  SceneObject,
  SceneSpec,
  Transform,
} from "@house/contracts";
import { footprint, insidePoint, scaledDimensions, overlaps } from "./geometry";

// Outer vertical extent remains useful for room bounds; contact uses exposed compound faces.
export const topY = (o: SceneObject) =>
  o.transform.position[1] + scaledDimensions(o)[1];
export function canSupport(
  parent: SceneObject,
  child: SceneObject,
  assets: Readonly<Record<string, AssetSpec>> = assetById,
): boolean {
  return contactFaces(parent, child, assets).some(
    (face) =>
      Math.abs(
        child.transform.position[1] - (face.heightY - (face.offsetY ?? 0)),
      ) <= CONTACT_EPS_M,
  );
}
export function supportCycle(scene: SceneSpec, o: SceneObject): boolean {
  const seen = new Set([o.id]);
  let parentId =
    o.placement?.support === "object" ? o.placement.parentId : undefined;
  while (parentId) {
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    const parent = scene.objects.find((p) => p.id === parentId);
    parentId =
      parent?.placement?.support === "object"
        ? parent.placement.parentId
        : undefined;
  }
  return false;
}
/** Face descriptors are world-space and renderer-independent. Bottom faces can
 * later describe ceiling contact; current supports are floor and furniture tops. */
export type SurfaceFace = {
  key: string;
  face: "top" | "bottom";
  heightY: number;
  /** Height of the carried model's lowest occupied face above its origin. */
  offsetY?: number;
  polygonXZ: [number, number][];
  label: string;
  placement: NonNullable<SceneObject["placement"]>;
};
export const FACE_SNAP_DISTANCE_M = 0.12;
/** Contact matches the collision tolerance: model files store positions to
 * tens of micrometres, so authored heights differ from baked tops by that much. */
const CONTACT_EPS_M = COLLISION_TOLERANCE_M;
/** Tops at most this much higher under a piece's footprint are part of the same
 * uneven surface (one 2 cm collider cell); taller ones are obstacles. */
const SETTLE_BAND_M = 0.02;
function contactFaces(
  parent: SceneObject,
  child: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
): SurfaceFace[] {
  if (parent.id === child.id || !overlaps(footprint(parent), footprint(child)))
    return [];
  const bottom = bottomContactFaces(child, assets),
    tops = topContactFaces(parent, assets);
  const under = (polygon: [number, number][]) =>
    bottom.polygons.some((p) => overlaps(p, polygon));
  return tops.flatMap((face) => {
    // Retain the bottom-center stability rule, while requiring actual occupied contact.
    if (
      !insidePoint(
        [child.transform.position[0], child.transform.position[2]],
        face.polygonXZ,
      ) ||
      !under(face.polygonXZ)
    )
      return [];
    // Real surfaces are uneven by millimetres: rest on the highest nearby top
    // beneath the piece's footprint, as a real object would.
    const heightY = Math.max(
      face.heightY,
      ...tops
        .filter(
          (t) =>
            t.heightY > face.heightY &&
            t.heightY <= face.heightY + SETTLE_BAND_M &&
            under(t.polygonXZ),
        )
        .map((t) => t.heightY),
    );
    const candidate = {
      ...child,
      transform: {
        ...child.transform,
        position: [
          child.transform.position[0],
          heightY - bottom.offsetY,
          child.transform.position[2],
        ] as [number, number, number],
      },
    };
    if (objectsCollide(parent, candidate, assets)) return [];
    return [
      {
        key: parent.id,
        face: "top" as const,
        ...face,
        heightY,
        offsetY: bottom.offsetY,
        label: parent.displayName,
        placement: { support: "object" as const, parentId: parent.id },
      },
    ];
  });
}
function surfaceFaces(
  scene: SceneSpec,
  o: SceneObject,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>>,
): SurfaceFace[] {
  const faces: SurfaceFace[] = [
    {
      key: "floor",
      face: "top",
      heightY: room.floor.elevationY,
      polygonXZ: room.floor.polygonXZ,
      label: "Floor",
      placement: { support: "floor" },
    },
  ];
  for (const parent of scene.objects) {
    const placement = { support: "object" as const, parentId: parent.id };
    if (supportCycle(scene, { ...o, placement })) continue;
    faces.push(...contactFaces(parent, o, assets));
  }
  return faces;
}
const atFace = (o: SceneObject, face: SurfaceFace): SceneObject => ({
  ...o,
  placement: face.placement,
  transform: {
    ...o.transform,
    position: [
      o.transform.position[0],
      face.face === "top"
        ? face.heightY - (face.offsetY ?? 0)
        : face.heightY - scaledDimensions(o)[1],
      o.transform.position[2],
    ],
  },
});
function rankedFaces(
  scene: SceneSpec,
  o: SceneObject,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>>,
) {
  return surfaceFaces(scene, o, room, assets)
    .map((surface) => ({ surface, object: atFace(o, surface) }))
    .sort(
      (a, b) =>
        Math.abs(a.object.transform.position[1] - o.transform.position[1]) -
        Math.abs(b.object.transform.position[1] - o.transform.position[1]),
    );
}
/** Magnetic contact during dragging and numeric entry. Free states stay free. */
export function snapToSurface(
  scene: SceneSpec,
  o: SceneObject,
  transform: Transform,
  room: RoomShell,
  distanceM = FACE_SNAP_DISTANCE_M,
  assets: Readonly<Record<string, AssetSpec>> = assetById,
): { transform: Transform; surface?: SurfaceFace } {
  if (o.locked || o.placement?.support === "wall") return { transform };
  const candidate = { ...o, transform };
  const nearest = rankedFaces(scene, candidate, room, assets)[0];
  if (
    !nearest ||
    Math.abs(nearest.object.transform.position[1] - transform.position[1]) >
      distanceM
  )
    return { transform };
  return { transform: nearest.object.transform, surface: nearest.surface };
}
/** Infer exact contact for every move, before validation or draft persistence. */
export function withContactSupport(
  scene: SceneSpec,
  o: SceneObject,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>> = assetById,
): SceneObject {
  if (o.placement?.support === "wall") return o;
  const nearest = rankedFaces(scene, o, room, assets)[0];
  return nearest &&
    Math.abs(nearest.object.transform.position[1] - o.transform.position[1]) <=
      CONTACT_EPS_M
    ? { ...o, placement: nearest.surface.placement }
    : { ...o, placement: { support: "floor" } };
}
/** Accept fallback for free suggestions; exact snapped contact remains unchanged. */
export function onNearestSurface(
  scene: SceneSpec,
  o: SceneObject,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>> = assetById,
): SceneObject {
  if (o.placement?.support === "wall") return o;
  return rankedFaces(scene, o, room, assets)[0].object;
}
