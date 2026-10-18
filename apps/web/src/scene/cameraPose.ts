import type { RoomShell, SceneSpec, Vec3 } from "@house/contracts";
import { boxCorners, insidePoint } from "@house/scene-engine";
export function roomBounds(shell: RoomShell) {
  const xs = shell.floor.polygonXZ.map((p) => p[0]),
    zs = shell.floor.polygonXZ.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
export function cameraPose(
  shell: RoomShell,
  view: "iso" | "top" | "eye",
): { position: Vec3; target: Vec3 } {
  const b = roomBounds(shell),
    width = b.maxX - b.minX,
    depth = b.maxZ - b.minZ,
    scale = Math.max(
      width / 5.2,
      depth / 4.4,
      (shell.ceilingHeightM ?? 2.6) / 2.6,
    );
  let cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  if (!insidePoint([cx, cz], shell.floor.polygonXZ)) {
    let best = Infinity;
    const x0 = cx,
      z0 = cz;
    for (let x = 1; x < 20; x++)
      for (let z = 1; z < 20; z++) {
        const px = b.minX + (width * x) / 20,
          pz = b.minZ + (depth * z) / 20,
          d = (px - x0) ** 2 + (pz - z0) ** 2;
        if (d < best && insidePoint([px, pz], shell.floor.polygonXZ)) {
          best = d;
          cx = px;
          cz = pz;
        }
      }
  }
  const floor = shell.floor.elevationY;
  if (view === "top")
    return {
      position: [cx, floor + 11 * scale, cz + 0.001],
      target: [cx, floor, cz],
    };
  if (view === "eye") {
    const y = floor + Math.min(1.6, (shell.ceilingHeightM ?? 2.6) - 0.2);
    return { position: [cx, y, cz + depth * 0.28], target: [cx, y, cz - 1] };
  }
  return {
    position: [cx + 7.2 * scale, floor + 0.65 + 5.85 * scale, cz + 8.3 * scale],
    target: [cx, floor + 0.65, cz],
  };
}
export function selectionBounds(
  scene: SceneSpec,
  ids: readonly string[],
): { min: Vec3; max: Vec3 } | undefined {
  const selected = new Set(ids),
    points = scene.objects
      .filter((o) => selected.has(o.id))
      .flatMap((o) => boxCorners(o));
  if (!points.length) return;
  return {
    min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as Vec3,
  };
}
