// Retain the previous linear query only as an independent test/benchmark oracle.
import type { AssetSpec, SceneObject } from "@house/contracts";
import { colliderBlocks, COLLISION_TOLERANCE_M } from "./collision";
import { footprint, overlaps, yawOf } from "./geometry";
function world(o: SceneObject, assets: Readonly<Record<string, AssetSpec>>) {
  const size = o.dimensionsM.map((n, i) => n * o.transform.scale[i]);
  const angle = yawOf(o.transform.rotation),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return colliderBlocks(o, assets).map(([lo, hi]) => {
    const x = ((lo[0] + hi[0]) / 2 - 0.5) * size[0],
      z = ((lo[2] + hi[2]) / 2 - 0.5) * size[2];
    const polygon = footprint({
      ...o,
      dimensionsM: [
        Math.max(0, (hi[0] - lo[0]) * size[0] - COLLISION_TOLERANCE_M),
        1,
        Math.max(0, (hi[2] - lo[2]) * size[2] - COLLISION_TOLERANCE_M),
      ],
      transform: {
        ...o.transform,
        position: [
          o.transform.position[0] + c * x + s * z,
          0,
          o.transform.position[2] - s * x + c * z,
        ],
        scale: [1, 1, 1],
      },
    });
    return {
      polygon,
      bottom: o.transform.position[1] + lo[1] * size[1],
      top: o.transform.position[1] + hi[1] * size[1],
      minX: Math.min(...polygon.map((p) => p[0])),
      maxX: Math.max(...polygon.map((p) => p[0])),
      minZ: Math.min(...polygon.map((p) => p[1])),
      maxZ: Math.max(...polygon.map((p) => p[1])),
    };
  });
}
export function collisionReference(
  a: SceneObject,
  b: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
  work?: { boxPairs: number },
): boolean {
  const aa = world(a, assets),
    bb = world(b, assets);
  for (const x of aa)
    for (const y of bb) {
      if (work) work.boxPairs++;
      if (
        Math.min(x.top, y.top) - Math.max(x.bottom, y.bottom) >
          COLLISION_TOLERANCE_M &&
        x.minX < y.maxX &&
        x.maxX > y.minX &&
        x.minZ < y.maxZ &&
        x.maxZ > y.minZ &&
        overlaps(x.polygon, y.polygon)
      )
        return true;
    }
  return false;
}
