import type { RoomShell, Vec3 } from "@house/contracts";
import { insidePoint } from "@house/scene-engine";
/** Fit lights in room coordinates; imported rooms need not surround the origin. */
export function lightingFrame(shell: RoomShell, elevationDeg: number) {
  const xs = shell.floor.polygonXZ.map((p) => p[0]),
    zs = shell.floor.polygonXZ.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radius =
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    ) /
      2 +
    0.8;
  const candidates = shell.openings.filter(
    (o) => o.glazing || o.kind === "window",
  );
  const main = candidates.sort(
    (a, b) => Number(!!b.glazing) - Number(!!a.glazing) || b.widthM - a.widthM,
  )[0];
  const wall = shell.walls.find((w) => w.id === main?.wallId);
  let inward = [0.55, 0.83];
  if (wall) {
    const dx = wall.toXZ[0] - wall.fromXZ[0],
      dz = wall.toXZ[1] - wall.fromXZ[1],
      len = Math.hypot(dx, dz);
    const n = [-dz / len, dx / len];
    const mid = [
      (wall.fromXZ[0] + wall.toXZ[0]) / 2,
      (wall.fromXZ[1] + wall.toXZ[1]) / 2,
    ];
    const distance = wall.thicknessM + 0.05;
    const sign = insidePoint(
      [mid[0] + n[0] * distance, mid[1] + n[1] * distance],
      shell.floor.polygonXZ,
    )
      ? 1
      : -1;
    inward = n.map((v) => v * sign);
  }
  const ax = -inward[0] + inward[1] * 0.35,
    az = -inward[1] - inward[0] * 0.35,
    n = Math.hypot(ax, az) || 1,
    el = (elevationDeg * Math.PI) / 180;
  return {
    target: [cx, shell.floor.elevationY, cz] as Vec3,
    radius,
    openingId: main?.id,
    position: [
      cx + (ax / n) * 12 * Math.cos(el),
      shell.floor.elevationY + 12 * Math.sin(el),
      cz + (az / n) * 12 * Math.cos(el),
    ] as Vec3,
  };
}
