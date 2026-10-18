import type {
  RoomShell,
  SceneObject,
  SceneSpec,
  Transform,
} from "@house/contracts";
import { footprint, insidePoint, scaledDimensions } from "./geometry";

// Every object exposes its bounding-box top as a support surface.
export const topY = (o: SceneObject) =>
  o.transform.position[1] + scaledDimensions(o)[1];
export function canSupport(parent: SceneObject, child: SceneObject): boolean {
  if (parent.id === child.id) return false;
  // Broad plant foliage may overhang; the bottom-face center must be supported.
  return insidePoint(
    [child.transform.position[0], child.transform.position[2]],
    footprint(parent),
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
  polygonXZ: [number, number][];
  label: string;
  placement: NonNullable<SceneObject["placement"]>;
};
export const FACE_SNAP_DISTANCE_M = 0.12;
const CONTACT_EPS_M = 1e-5;
function surfaceFaces(
  scene: SceneSpec,
  o: SceneObject,
  room: RoomShell,
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
    if (!canSupport(parent, o)) continue;
    const placement = { support: "object" as const, parentId: parent.id };
    if (supportCycle(scene, { ...o, placement })) continue;
    faces.push({
      key: parent.id,
      face: "top",
      heightY: topY(parent),
      polygonXZ: footprint(parent),
      label: parent.displayName,
      placement,
    });
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
        ? face.heightY
        : face.heightY - scaledDimensions(o)[1],
      o.transform.position[2],
    ],
  },
});
function rankedFaces(scene: SceneSpec, o: SceneObject, room: RoomShell) {
  return surfaceFaces(scene, o, room)
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
): { transform: Transform; surface?: SurfaceFace } {
  if (o.locked || o.placement?.support === "wall") return { transform };
  const candidate = { ...o, transform };
  const nearest = rankedFaces(scene, candidate, room)[0];
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
): SceneObject {
  if (o.placement?.support === "wall") return o;
  const nearest = rankedFaces(scene, o, room)[0];
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
): SceneObject {
  if (o.placement?.support === "wall") return o;
  return rankedFaces(scene, o, room)[0].object;
}
