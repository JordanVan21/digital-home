import { onWall, onCeiling } from "./mounting";
import { assetById, type AssetSpec } from "@house/contracts";
import {
  COLLISION_TOLERANCE_M,
  objectsCollide,
  objectContactPoints,
  colliderBlocks,
  objectCentre,
} from "./collision";
import { topContactFaces, bottomContactFaces } from "./contactFaces";
import type {
  RoomShell,
  SceneObject,
  SceneSpec,
  Transform,
} from "@house/contracts";
import {
  footprint,
  insidePoint,
  scaledDimensions,
  overlaps,
  verticalBounds,
  convexHull,
  boxCorners,
} from "./geometry";

// Outer vertical extent remains useful for room bounds; contact uses exposed compound faces.
export const topY = (o: SceneObject) => verticalBounds(o).top;
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
  if (o.placement?.float) return false;
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
  const c = objectCentre(child, assets);
  const centre: [number, number] = [c[0], c[2]];
  const childFootprint = footprint(child);
  const touching = tops.filter((t) => overlaps(childFootprint, t.polygonXZ));
  const centred = touching.filter((t) => insidePoint(centre, t.polygonXZ));
  const candidates = centred.length ? centred : touching;
  const visited = new Set<number>();
  return candidates.flatMap((face) => {
    const contact = touching.filter(
      (t) => Math.abs(t.heightY - face.heightY) <= SETTLE_BAND_M,
    );
    if (!insidePoint(centre, convexHull(contact.flatMap((t) => t.polygonXZ))))
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
    if (visited.has(heightY)) return [];
    visited.add(heightY);
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
    const upright =
      Math.abs(child.transform.rotation[0]) +
        Math.abs(child.transform.rotation[2]) <
      1e-7;
    if (!upright) {
      const points = objectContactPoints(
        parent,
        candidate,
        assets,
        SETTLE_BAND_M,
      );
      if (
        !stableOverContacts(
          candidate,
          points.map((p) => [p[0], p[2]]),
          assets,
        )
      )
        return [];
    }

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
export function surfaceFaces(
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
      offsetY: bottomContactFaces(o, assets).offsetY,
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
  if (o.placement?.support === "ceiling") {
    const mounted = onCeiling(room, { ...o, transform });
    return Math.abs(mounted.transform.position[1] - transform.position[1]) <=
      distanceM
      ? { transform: mounted.transform }
      : { transform };
  }
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
  if (o.placement?.float) return o;
  if (o.placement?.support === "wall")
    return { ...o, placement: onWall(room, o).placement };
  if (o.placement?.support === "ceiling") return o;
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
  if (o.placement?.float) return o;
  if (o.placement?.support === "wall") return onWall(room, o, true);
  if (o.placement?.support === "ceiling") return onCeiling(room, o);
  return rankedFaces(scene, o, room, assets)[0].object;
}

/** The projected geometric centre must lie within the convex contact region.
 * Lines and points are valid only when the centre projects onto them. */
export function stableOverContacts(
  o: SceneObject,
  points: [number, number][],
  assets: Readonly<Record<string, AssetSpec>> = {},
): boolean {
  const c = objectCentre(o, assets);
  const centre: [number, number] = [c[0], c[2]];
  const hull = convexHull(points);
  if (hull.length >= 3 && insidePoint(centre, hull)) return true;
  return hull.some((a, i) => {
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = dx * dx + dz * dz;
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((centre[0] - a[0]) * dx + (centre[1] - a[1]) * dz) / length,
          ),
        )
      : 0;
    return (
      Math.hypot(centre[0] - a[0] - t * dx, centre[1] - a[1] - t * dz) <=
      CONTACT_EPS_M
    );
  });
}
export function hasFloorSupport(
  o: SceneObject,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>>,
): boolean {
  // Authored upright assets are assumed stable on their base: their material
  // density (e.g. an arc lamp's weighted foot) is absent from collider metadata.
  if (
    Math.abs(o.transform.rotation[0]) + Math.abs(o.transform.rotation[2]) <
    1e-7
  )
    return (
      Math.abs(o.transform.position[1] - room.floor.elevationY) <= CONTACT_EPS_M
    );
  const points = colliderBlocks(o, assets)
    .flatMap(([min, max]) => boxCorners(o, min, max))
    .filter((p) => Math.abs(p[1] - room.floor.elevationY) <= CONTACT_EPS_M);
  return (
    points.length > 0 &&
    (Math.abs(o.transform.rotation[0]) + Math.abs(o.transform.rotation[2]) <
      1e-7 ||
      stableOverContacts(
        o,
        points.map((p) => [p[0], p[2]]),
        assets,
      ))
  );
}
