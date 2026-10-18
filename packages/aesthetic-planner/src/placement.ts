import type { SceneObject, SceneSpec, RoomShell } from "@house/contracts";
import {
  onNearestSurface,
  validateObject,
  yawOf,
  type SceneContext,
} from "@house/scene-engine";
import type { PlacementIntent } from "./schema";

const pose = (
  object: SceneObject,
  x: number,
  z: number,
  yaw: number,
  floor: number,
): SceneObject => ({
  ...object,
  transform: {
    position: [x, floor, z],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    scale: [1, 1, 1],
  },
});

/** Candidate generation/ranking is deterministic. The shared validator decides which are legal. */
export function placeObject(
  object: SceneObject,
  intent: PlacementIntent,
  scene: SceneSpec,
  shell: RoomShell,
  ctx: SceneContext,
  anchor?: SceneObject,
): SceneObject | null {
  if ((intent.zone === "on" || intent.relation === "on") && anchor) {
    const candidate = {
      ...object,
      transform: {
        ...object.transform,
        position: [
          anchor.transform.position[0],
          anchor.transform.position[1] + anchor.dimensionsM[1],
          anchor.transform.position[2],
        ] as [number, number, number],
      },
    };
    const supported = onNearestSurface(scene, candidate, shell, ctx.assets);
    return supported.placement?.parentId === anchor.id &&
      validateObject(scene, supported, ctx).ok
      ? supported
      : null;
  }
  if (intent.zone === "original")
    if (validateObject(scene, object, ctx).ok) return object;
  if (intent.zone === "near" && !anchor)
    throw new Error("A nearby placement needs a previously placed anchor.");
  const xs = shell.floor.polygonXZ.map((p) => p[0]);
  const zs = shell.floor.polygonXZ.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  const center = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const wall = shell.walls.find((w) => w.id === intent.wallId);
  if (intent.zone === "wall" && !wall)
    throw new Error("Wall placement needs a real wall ID.");
  const candidates: { object: SceneObject; score: number }[] = [];
  for (let x = minX + 0.15; x < maxX; x += 0.3) {
    for (let z = minZ + 0.15; z < maxZ; z += 0.3) {
      for (let turn = 0; turn < 4; turn++) {
        let yaw = (turn * Math.PI) / 2;
        let score = Math.hypot(x - center[0], z - center[1]);
        if (intent.zone === "original")
          score =
            Math.hypot(
              x - object.transform.position[0],
              z - object.transform.position[2],
            ) +
            Math.abs(
              Math.atan2(
                Math.sin(yaw - yawOf(object.transform.rotation)),
                Math.cos(yaw - yawOf(object.transform.rotation)),
              ),
            ) *
              0.05;
        if (wall) {
          const [ax, az] = wall.fromXZ,
            [bx, bz] = wall.toXZ;
          const dx = bx - ax,
            dz = bz - az;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
          );
          const wx = ax + t * dx,
            wz = az + t * dz;
          yaw = Math.atan2(x - wx, z - wz); // front (+Z) faces away from wall into room
          score =
            Math.abs(
              Math.hypot(x - wx, z - wz) - object.dimensionsM[2] / 2 - 0.12,
            ) +
            Math.hypot(x - (ax + bx) / 2, z - (az + bz) / 2) * 0.15;
        }
        if (anchor) {
          const [ax, , az] = anchor.transform.position;
          const forward = yawOf(anchor.transform.rotation);
          const radii =
            Math.hypot(anchor.dimensionsM[0], anchor.dimensionsM[2]) / 2 +
            Math.hypot(object.dimensionsM[0], object.dimensionsM[2]) / 2;
          score = Math.abs(Math.hypot(x - ax, z - az) - radii - 0.35);
          if (
            intent.relation === "in_front_of" ||
            intent.relation === "beside"
          ) {
            const a =
              forward + (intent.relation === "beside" ? Math.PI / 2 : 0);
            score += Math.hypot(
              x - ax - Math.sin(a) * (radii + 0.35),
              z - az - Math.cos(a) * (radii + 0.35),
            );
          }
          if (intent.relation === "faces") yaw = Math.atan2(ax - x, az - z);
        }
        candidates.push({
          object: pose(object, x, z, yaw, shell.floor.elevationY),
          score,
        });
        if (wall || intent.relation === "faces") break;
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates)
    if (validateObject(scene, candidate.object, ctx).ok)
      return candidate.object;
  return null;
}
