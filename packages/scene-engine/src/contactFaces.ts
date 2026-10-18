import type { AssetSpec, SceneObject } from "@house/contracts";
import { colliderBlocks } from "./collision";
import { rectangle, scaledDimensions, yawOf, type Point } from "./geometry";
type Rect = [number, number, number, number];
type Face = { rect: Rect; height: number };
const EPS = 1e-7;
const cache = new WeakMap<number[][][], Face[]>();
/** Subtract occluding columns, so the guide never exposes an internal voxel face. */
function subtract(rect: Rect, cut: Rect): Rect[] {
  const [x0, z0, x1, z1] = rect;
  const a = Math.max(x0, cut[0]),
    b = Math.max(z0, cut[1]),
    c = Math.min(x1, cut[2]),
    d = Math.min(z1, cut[3]);
  if (c - a <= EPS || d - b <= EPS) return [rect];
  return [
    [x0, z0, a, z1],
    [c, z0, x1, z1],
    [a, z0, c, b],
    [a, d, c, z1],
  ].filter(([x, z, u, v]) => u - x > EPS && v - z > EPS) as Rect[];
}
function exposedTops(boxes: number[][][]): Face[] {
  const cached = cache.get(boxes);
  if (cached) return cached;
  const faces: Face[] = [];
  for (const [min, max] of boxes) {
    let patches: Rect[] = [[min[0], min[2], max[0], max[2]]];
    for (const [low, high] of boxes) {
      if (low[1] > max[1] + EPS || high[1] <= max[1] + EPS) continue;
      patches = patches.flatMap((rect) =>
        subtract(rect, [low[0], low[2], high[0], high[2]]),
      );
      if (!patches.length) break;
    }
    faces.push(...patches.map((rect) => ({ rect, height: max[1] })));
  }
  cache.set(boxes, faces);
  return faces;
}
function worldFace(o: SceneObject, f: Face) {
  const size = scaledDimensions(o),
    yaw = yawOf(o.transform.rotation),
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  const [x0, z0, x1, z1] = f.rect;
  const x = ((x0 + x1) / 2 - 0.5) * size[0],
    z = ((z0 + z1) / 2 - 0.5) * size[2];
  return {
    heightY: o.transform.position[1] + f.height * size[1],
    polygonXZ: rectangle(
      [
        o.transform.position[0] + c * x + s * z,
        o.transform.position[2] - s * x + c * z,
      ],
      (x1 - x0) * size[0],
      (z1 - z0) * size[2],
      yaw,
    ),
  };
}
export function topContactFaces(
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
) {
  return exposedTops(colliderBlocks(o, assets)).map((f) => worldFace(o, f));
}
/** Actual lowest occupied faces, rather than the empty center of a hollow model. */
export function bottomContactFaces(
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
): { offsetY: number; polygons: Point[][] } {
  const boxes = colliderBlocks(o, assets),
    min = Math.min(...boxes.map(([lo]) => lo[1]));
  return {
    offsetY: min * scaledDimensions(o)[1],
    polygons: boxes
      .filter(([lo]) => Math.abs(lo[1] - min) < EPS)
      .map(
        ([lo, hi]) =>
          worldFace(o, { rect: [lo[0], lo[2], hi[0], hi[2]], height: min })
            .polygonXZ,
      ),
  };
}
