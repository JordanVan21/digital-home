import type { Opening, RoomShell, Vec2, Wall } from '@house/contracts';
import { add2, len2, normalize2, scale2, sub2 } from './math';
import { normalizeWinding, pointInPolygonStrict } from './polygon';
import type { OBB } from './obb';

/**
 * Wall placement convention (CONTRACT-TBD): wall segments lie on the floor polygon boundary
 * (the room's interior face); `thicknessM` extrudes outward, away from the room.
 */
export type WallFrame = {
  wall: Wall;
  from: Vec2;
  to: Vec2;
  /** Unit direction from → to. */
  dir: Vec2;
  length: number;
  /** Unit normal pointing into the room. */
  inward: Vec2;
  /** Yaw an object must have for its front (+Z) to face into the room. */
  inwardYaw: number;
};

/** Shell with winding normalized (CCW viewed from +Y). Returns a new object; input untouched. */
export function normalizeShell(shell: RoomShell): RoomShell {
  return { ...shell, floor: { ...shell.floor, polygonXZ: normalizeWinding(shell.floor.polygonXZ) } };
}

export function wallFrame(wall: Wall, polygon: readonly Vec2[]): WallFrame {
  const from: Vec2 = [wall.fromXZ[0], wall.fromXZ[1]];
  const to: Vec2 = [wall.toXZ[0], wall.toXZ[1]];
  const d = sub2(to, from);
  const length = len2(d);
  const dir = normalize2(d);
  // For a CCW-from-above traversal the interior is on the left as seen from above: n = (dz, −dx).
  let inward: Vec2 = [dir[1], -dir[0]];
  const mid = add2(from, scale2(d, 0.5));
  const probe = 0.05;
  if (!pointInPolygonStrict(add2(mid, scale2(inward, probe)), polygon)
    && pointInPolygonStrict(add2(mid, scale2(inward, -probe)), polygon)) {
    inward = [-inward[0], -inward[1]];
  }
  return { wall, from, to, dir, length, inward, inwardYaw: Math.atan2(inward[0], inward[1]) };
}

export function wallFrames(shell: RoomShell): WallFrame[] {
  return shell.walls.map((w) => wallFrame(w, shell.floor.polygonXZ));
}

export type OpeningFrame = {
  opening: Opening;
  frame: WallFrame;
  /** Opening span along the wall in XZ. */
  start: Vec2;
  end: Vec2;
};

export function openingFrames(shell: RoomShell, frames = wallFrames(shell)): OpeningFrame[] {
  const byId = new Map(frames.map((f) => [f.wall.id, f]));
  const out: OpeningFrame[] = [];
  for (const opening of shell.openings) {
    const frame = byId.get(opening.wallId);
    if (!frame) continue;
    const start = add2(frame.from, scale2(frame.dir, opening.offsetM));
    const end = add2(frame.from, scale2(frame.dir, opening.offsetM + opening.widthM));
    out.push({ opening, frame, start, end });
  }
  return out;
}

/** Keep-out approach zone on the room side of a door/opening. Height spans the opening. */
export function approachZone(of: OpeningFrame, depthM: number): OBB {
  const { opening, frame } = of;
  const mid = scale2(add2(of.start, of.end), 0.5);
  return {
    center: add2(mid, scale2(frame.inward, depthM / 2)),
    u: frame.dir,
    v: frame.inward,
    halfW: opening.widthM / 2,
    halfD: depthM / 2,
    yMin: opening.bottomM,
    yMax: opening.bottomM + opening.heightM,
  };
}
