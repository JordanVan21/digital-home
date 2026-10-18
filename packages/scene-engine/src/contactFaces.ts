import type { AssetSpec, SceneObject } from "@house/contracts";
import { rotateVector } from "./rotation";
import { colliderBlocks } from "./collision";
import {
  rectangle,
  scaledDimensions,
  yawOf,
  boxCorners,
  convexHull,
  type Point,
} from "./geometry";
type Rect = [number, number, number, number];
type Face = { rect: Rect; height: number };
const EPS = 1e-7;
const cache = new WeakMap<number[][][], Face[]>();
const orientedProfiles = new WeakMap<number[][][], Map<string, number[][][]>>();
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
  if (
    Math.abs(o.transform.rotation[0]) + Math.abs(o.transform.rotation[2]) <
    1e-7
  )
    return exposedTops(colliderBlocks(o, assets)).map((f) => worldFace(o, f));
  const boxes = colliderBlocks(o, assets),
    size = scaledDimensions(o);
  const result: { heightY: number; polygonXZ: Point[] }[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const unit = [0, 0, 0] as [number, number, number];
      unit[axis] = sign;
      const normal = rotateVector(unit, o.transform.rotation);
      if (normal[1] < 1 - 1e-7) continue;
      const remaining = [0, 1, 2].filter((i) => i !== axis);
      // Convert this local face direction to exposedTops' coordinate convention.
      let orientations = orientedProfiles.get(boxes);
      if (!orientations)
        orientedProfiles.set(boxes, (orientations = new Map()));
      const key = `${axis},${sign}`;
      let mapped = orientations.get(key);
      if (!mapped) {
        mapped = boxes.map(([lo, hi]) => [
          [
            lo[remaining[0]],
            sign > 0 ? lo[axis] : 1 - hi[axis],
            lo[remaining[1]],
          ],
          [
            hi[remaining[0]],
            sign > 0 ? hi[axis] : 1 - lo[axis],
            hi[remaining[1]],
          ],
        ]);
        orientations.set(key, mapped);
      }
      for (const f of exposedTops(mapped)) {
        const [x0, z0, x1, z1] = f.rect;
        const points = (
          [
            [x0, z0],
            [x1, z0],
            [x1, z1],
            [x0, z1],
          ] as Point[]
        ).map(([x, z]) => {
          const v = [0, 0, 0] as [number, number, number];
          v[remaining[0]] = x;
          v[remaining[1]] = z;
          v[axis] = sign > 0 ? f.height : 1 - f.height;
          const local = v.map(
            (n, i) => (n - (i === 1 ? 0 : 0.5)) * size[i],
          ) as [number, number, number];
          return rotateVector(local, o.transform.rotation).map(
            (n, i) => n + o.transform.position[i],
          );
        });
        result.push({
          heightY: points[0][1],
          polygonXZ: points.map((p) => [p[0], p[2]]),
        });
      }
    }
  return result;
}
/** Actual lowest occupied faces, rather than the empty center of a hollow model. */
export function bottomContactFaces(
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
): { offsetY: number; polygons: Point[][] } {
  if (
    Math.abs(o.transform.rotation[0]) + Math.abs(o.transform.rotation[2]) >
    1e-7
  ) {
    const boxes = colliderBlocks(o, assets).map(([min, max]) =>
      boxCorners(o, min, max),
    );
    const min = Math.min(
      ...boxes.map((ps) => Math.min(...ps.map((p) => p[1]))),
    );
    return {
      offsetY: min - o.transform.position[1],
      polygons: boxes
        .filter((ps) => ps.some((p) => Math.abs(p[1] - min) < EPS))
        .map((ps) => convexHull(ps.map((p) => [p[0], p[2]]))),
    };
  }
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
