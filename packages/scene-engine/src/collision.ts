import type { Quat, RoomShell, SceneObject, Vec3, Wall } from "@house/contracts";
import { type OBB, obbCorners, obbOverlap, pointInPolygonXZ, yawRadiansFromQuaternion } from "./geometry";

/** How far into the room a doorway's swing/approach must stay clear. */
const DOORWAY_KEEP_OUT_DEPTH_M = 0.6;

/**
 * Categories that sit flat on the floor but are semantically transparent to
 * placement on top of them (CONTRACTS.md §4: "rug under table" exemption).
 * Keep this list narrow and explicit rather than a blanket overlap bypass.
 */
const OVERLAP_EXEMPT_CATEGORIES = new Set(["rug"]);

export function footprintOBB(position: Vec3, rotation: Quat, dimensionsM: Vec3): OBB {
  return {
    center: [position[0], position[2]],
    halfExtents: [dimensionsM[0] / 2, dimensionsM[2] / 2],
    yaw: yawRadiansFromQuaternion(rotation),
  };
}

/**
 * Whether an object participates in floor-plane checks at all. Wall- and
 * object-mounted items (art, a lamp sitting on a desk) live in a different
 * vertical layer and are exempt entirely, per CONTRACTS.md §4's semantic
 * exemptions — not checked against the floor polygon, walls, doorways, or
 * other floor objects.
 */
export function isFloorSupported(object: Pick<SceneObject, "placement">): boolean {
  return !object.placement || object.placement.support === "floor";
}

function isOverlapExempt(category: string): boolean {
  return OVERLAP_EXEMPT_CATEGORIES.has(category);
}

/** All four footprint corners must land inside the room's floor polygon. */
export function checkFloorContainment(shell: RoomShell, obb: OBB): boolean {
  return obbCorners(obb).every((corner) => pointInPolygonXZ(corner, shell.floor.polygonXZ));
}

function wallInnerFaceNormal(wall: Wall, roomCentroid: [number, number]): [number, number] {
  const [fx, fz] = wall.fromXZ;
  const [tx, tz] = wall.toXZ;
  const dx = tx - fx;
  const dz = tz - fz;
  const length = Math.hypot(dx, dz) || 1;
  const mx = (fx + tx) / 2;
  const mz = (fz + tz) / 2;
  let nx = -dz / length;
  let nz = dx / length;
  const towardCentroid = (roomCentroid[0] - mx) * nx + (roomCentroid[1] - mz) * nz;
  if (towardCentroid < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

function roomCentroid(shell: RoomShell): [number, number] {
  const pts = shell.floor.polygonXZ;
  const cx = pts.reduce((sum, [x]) => sum + x, 0) / pts.length;
  const cz = pts.reduce((sum, [, z]) => sum + z, 0) / pts.length;
  return [cx, cz];
}

/**
 * No part of the footprint may cross into a wall's solid thickness — i.e.
 * every corner must be on the interior side of every wall's inner face.
 * Returns the offending wall id, or null if clear.
 */
export function checkWallClearance(shell: RoomShell, obb: OBB): string | null {
  const centroid = roomCentroid(shell);
  const corners = obbCorners(obb);
  for (const wall of shell.walls) {
    const [fx, fz] = wall.fromXZ;
    const [nx, nz] = wallInnerFaceNormal(wall, centroid);
    const innerFaceOffset = wall.thicknessM / 2;
    for (const [cx, cz] of corners) {
      const distance = (cx - fx) * nx + (cz - fz) * nz;
      if (distance < innerFaceOffset - 1e-6) return wall.id;
    }
  }
  return null;
}

/** Keeps a floor-level footprint out of a door opening's swing/approach zone. */
export function checkDoorwayKeepOut(shell: RoomShell, obb: OBB): string | null {
  const centroid = roomCentroid(shell);
  for (const opening of shell.openings) {
    if (opening.kind !== "door") continue;
    const wall = shell.walls.find((w) => w.id === opening.wallId);
    if (!wall) continue;

    const [fx, fz] = wall.fromXZ;
    const [tx, tz] = wall.toXZ;
    const dx = tx - fx;
    const dz = tz - fz;
    const length = Math.hypot(dx, dz) || 1;
    const dirX = dx / length;
    const dirZ = dz / length;
    const [nx, nz] = wallInnerFaceNormal(wall, centroid);

    const openingMid = opening.offsetM + opening.widthM / 2;
    const atWallX = fx + dirX * openingMid;
    const atWallZ = fz + dirZ * openingMid;
    const keepOut: OBB = {
      center: [
        atWallX + nx * (wall.thicknessM / 2 + DOORWAY_KEEP_OUT_DEPTH_M / 2),
        atWallZ + nz * (wall.thicknessM / 2 + DOORWAY_KEEP_OUT_DEPTH_M / 2),
      ],
      halfExtents: [opening.widthM / 2, DOORWAY_KEEP_OUT_DEPTH_M / 2],
      yaw: Math.atan2(-dirZ, dirX),
    };
    if (obbOverlap(obb, keepOut)) return opening.id;
  }
  return null;
}

/**
 * Checks a candidate footprint against every other floor-supported object
 * in the scene, skipping both wall/object-mounted items (different layer)
 * and the explicit rug exemption. Returns the blocking object, or null.
 */
export function checkObjectOverlap(
  candidate: { obb: OBB; category: string },
  others: SceneObject[]
): SceneObject | null {
  if (isOverlapExempt(candidate.category)) return null;
  for (const other of others) {
    if (!isFloorSupported(other) || isOverlapExempt(other.category)) continue;
    const otherObb = footprintOBB(other.transform.position, other.transform.rotation, other.dimensionsM);
    if (obbOverlap(candidate.obb, otherObb)) return other;
  }
  return null;
}
