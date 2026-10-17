import type { Opening, Wall } from "@house/contracts";

export interface WallSegment {
  /** World-space center of the segment box. */
  center: [number, number, number];
  /** [length along wall, height, thickness]. */
  size: [number, number, number];
  /** Yaw to align the segment's local X axis with the wall direction. */
  rotationY: number;
  /** Source wall, so the viewer can fade all of a wall's segments together. */
  wallId: string;
}

/**
 * Procedurally splits a wall into solid box segments, carving out its
 * openings (sill below + header above, when present) without CSG. Visual
 * only — RoomShell geometry itself stays authoritative and immutable.
 */
export function buildWallSegments(wall: Wall, openings: Opening[]): WallSegment[] {
  const [fx, fz] = wall.fromXZ;
  const [tx, tz] = wall.toXZ;
  const dx = tx - fx;
  const dz = tz - fz;
  const length = Math.hypot(dx, dz);
  // three.js Ry(θ) maps local +X to world (cosθ, 0, -sinθ); solve for θ so
  // that local +X (the segment's "length" axis) follows (dx, dz).
  const rotationY = Math.atan2(-dz, dx);

  const wallOpenings = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      start: Math.max(0, o.offsetM),
      end: Math.min(length, o.offsetM + o.widthM),
      bottom: o.bottomM,
      top: o.bottomM + o.heightM,
    }))
    .sort((a, b) => a.start - b.start);

  const segments: WallSegment[] = [];
  const toWorld = (alongWall: number): [number, number] => [
    fx + (dx / length) * alongWall,
    fz + (dz / length) * alongWall,
  ];
  const pushSegment = (start: number, end: number, bottom: number, top: number) => {
    const segLength = end - start;
    const segHeight = top - bottom;
    if (segLength <= 0.001 || segHeight <= 0.001) return;
    const [cx, cz] = toWorld((start + end) / 2);
    segments.push({
      center: [cx, bottom + segHeight / 2, cz],
      size: [segLength, segHeight, wall.thicknessM],
      rotationY,
      wallId: wall.id,
    });
  };

  let cursor = 0;
  for (const opening of wallOpenings) {
    if (opening.start > cursor) {
      pushSegment(cursor, opening.start, 0, wall.heightM);
    }
    if (opening.bottom > 0) {
      pushSegment(opening.start, opening.end, 0, opening.bottom);
    }
    if (opening.top < wall.heightM) {
      pushSegment(opening.start, opening.end, opening.top, wall.heightM);
    }
    cursor = Math.max(cursor, opening.end);
  }
  if (cursor < length) {
    pushSegment(cursor, length, 0, wall.heightM);
  }

  return segments;
}
