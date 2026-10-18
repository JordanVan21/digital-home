import type { RoomShell, SceneObject } from "@house/contracts";
import { boxCorners, insidePoint, verticalBounds, yawOf } from "./geometry";
import { worldYaw } from "./rotation";
export function wallFrame(room: RoomShell, wallId: string) {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return;
  const dx = wall.toXZ[0] - wall.fromXZ[0],
    dz = wall.toXZ[1] - wall.fromXZ[1],
    length = Math.hypot(dx, dz);
  if (!length) return;
  const tangent: [number, number] = [dx / length, dz / length];
  let normal: [number, number] = [-tangent[1], tangent[0]];
  const mid: [number, number] = [
    (wall.fromXZ[0] + wall.toXZ[0]) / 2,
    (wall.fromXZ[1] + wall.toXZ[1]) / 2,
  ];
  if (
    !insidePoint(
      [mid[0] + normal[0] * 0.1, mid[1] + normal[1] * 0.1],
      room.floor.polygonXZ,
    )
  )
    normal = [-normal[0], -normal[1]];
  return { wall, length, tangent, normal };
}
/** Mount the model's rear extent on the inner wall face; choose the nearest wall, including corners. */
export function onWall(
  room: RoomShell,
  object: SceneObject,
  settle = false,
): SceneObject {
  const [x, y, z] = object.transform.position;
  const frames = room.walls.flatMap((w) => {
    const f = wallFrame(room, w.id);
    return f ? [f] : [];
  });
  frames.sort((a, b) => {
    const distance = (f: typeof a) => {
      const along = Math.max(
        0,
        Math.min(
          f.length,
          (x - f.wall.fromXZ[0]) * f.tangent[0] +
            (z - f.wall.fromXZ[1]) * f.tangent[1],
        ),
      );
      return Math.hypot(
        x - f.wall.fromXZ[0] - along * f.tangent[0],
        z - f.wall.fromXZ[1] - along * f.tangent[1],
      );
    };
    return distance(a) - distance(b);
  });
  const f = frames[0];
  if (!f) return object;
  const rotation = worldYaw(
    object.transform.rotation,
    Math.atan2(f.normal[0], f.normal[1]) - yawOf(object.transform.rotation),
  );
  const local = {
    ...object,
    transform: {
      ...object.transform,
      position: [0, 0, 0] as [number, number, number],
      rotation,
    },
  };
  const points = boxCorners(local),
    alongs = points.map((p) => p[0] * f.tangent[0] + p[2] * f.tangent[1]),
    depths = points.map((p) => p[0] * f.normal[0] + p[2] * f.normal[1]);
  const along = Math.max(
    -Math.min(...alongs),
    Math.min(
      f.length - Math.max(...alongs),
      (x - f.wall.fromXZ[0]) * f.tangent[0] +
        (z - f.wall.fromXZ[1]) * f.tangent[1],
    ),
  );
  const depth = f.wall.thicknessM / 2 - Math.min(...depths);
  const bounds = verticalBounds(local);
  const height = settle
    ? Math.max(
        room.floor.elevationY - bounds.bottom,
        Math.min(room.floor.elevationY + f.wall.heightM - bounds.top, y),
      )
    : y;
  return {
    ...object,
    placement: { ...object.placement, support: "wall", parentId: f.wall.id },
    transform: {
      ...object.transform,
      rotation,
      position: [
        f.wall.fromXZ[0] + along * f.tangent[0] + depth * f.normal[0],
        height,
        f.wall.fromXZ[1] + along * f.tangent[1] + depth * f.normal[1],
      ],
    },
  };
}
export function onCeiling(room: RoomShell, object: SceneObject): SceneObject {
  const ceiling =
    room.floor.elevationY +
    (room.ceilingHeightM ?? Math.max(...room.walls.map((w) => w.heightM)));
  return {
    ...object,
    placement: { ...object.placement, support: "ceiling" },
    transform: {
      ...object.transform,
      position: [
        object.transform.position[0],
        object.transform.position[1] + ceiling - verticalBounds(object).top,
        object.transform.position[2],
      ],
    },
  };
}
/** Exact wall contact, containment along the wall, and openings in its vertical span. */
export function hasWallSupport(room: RoomShell, object: SceneObject): boolean {
  const f = wallFrame(room, object.placement?.parentId ?? "");
  if (!f) return false;
  const points = boxCorners(object),
    along = points.map(
      (p) =>
        (p[0] - f.wall.fromXZ[0]) * f.tangent[0] +
        (p[2] - f.wall.fromXZ[1]) * f.tangent[1],
    );
  const depth = Math.min(
    ...points.map(
      (p) =>
        (p[0] - f.wall.fromXZ[0]) * f.normal[0] +
        (p[2] - f.wall.fromXZ[1]) * f.normal[1],
    ),
  );
  const min = Math.min(...along),
    max = Math.max(...along),
    v = verticalBounds(object);
  return (
    Math.abs(depth - f.wall.thicknessM / 2) <= 0.0001 &&
    min >= -0.0001 &&
    max <= f.length + 0.0001 &&
    !room.openings.some(
      (o) =>
        o.wallId === f.wall.id &&
        max > o.offsetM + 0.0001 &&
        min < o.offsetM + o.widthM - 0.0001 &&
        v.top > room.floor.elevationY + o.bottomM + 0.0001 &&
        v.bottom < room.floor.elevationY + o.bottomM + o.heightM - 0.0001,
    )
  );
}
