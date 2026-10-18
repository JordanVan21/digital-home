import type { Opening, RoomShell, Wall } from "@house/contracts";
import { insidePoint } from "@house/scene-engine";
export const CUTAWAY_HEIGHT_M = 0.17;
export type WallMode = "cutaway" | "fade" | "show";
export function wallFrame(shell: RoomShell, wall: Wall) {
  const dx = wall.toXZ[0] - wall.fromXZ[0],
    dz = wall.toXZ[1] - wall.fromXZ[1],
    length = Math.hypot(dx, dz);
  const center: [number, number] = [
    (wall.fromXZ[0] + wall.toXZ[0]) / 2,
    (wall.fromXZ[1] + wall.toXZ[1]) / 2,
  ];
  const n: [number, number] = [-dz / length, dx / length],
    distance = wall.thicknessM + 0.05;
  const sign = insidePoint(
    [center[0] + n[0] * distance, center[1] + n[1] * distance],
    shell.floor.polygonXZ,
  )
    ? 1
    : -1;
  return {
    center,
    length,
    yaw: -Math.atan2(dz, dx),
    outward: [-n[0] * sign, -n[1] * sign] as [number, number],
  };
}
export function wallPanels(
  length: number,
  height: number,
  openings: readonly Opening[],
) {
  const panels: { s0: number; s1: number; y0: number; y1: number }[] = [];
  let cursor = 0;
  for (const o of [...openings].sort((a, b) => a.offsetM - b.offsetM)) {
    const s0 = Math.max(cursor, o.offsetM),
      s1 = Math.min(length, o.offsetM + o.widthM);
    if (s1 <= s0) continue;
    if (s0 > cursor) panels.push({ s0: cursor, s1: s0, y0: 0, y1: height });
    if (o.bottomM > 0)
      panels.push({ s0, s1, y0: 0, y1: Math.min(height, o.bottomM) });
    const top = o.bottomM + o.heightM;
    if (top < height) panels.push({ s0, s1, y0: top, y1: height });
    cursor = s1;
  }
  if (cursor < length)
    panels.push({ s0: cursor, s1: length, y0: 0, y1: height });
  return panels.filter((p) => p.s1 > p.s0 && p.y1 > p.y0);
}
export function wallVisibility(mode: WallMode, facing: boolean) {
  return mode === "show" || !facing ? 1 : mode === "fade" ? 0.1 : 0;
}
