// Experimental browser/benchmark adapter. Never imported by the scene engine.
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  Object3D,
  Ray,
  Sphere,
  Triangle,
  Vector3,
} from "three";
import { MeshBVH } from "three-mesh-bvh";
export type Profile = {
  geometry: BufferGeometry;
  tree: MeshBVH;
  bounds: Box3;
  boxes: Box3[];
  triangles: number;
  surfaceCells: number;
  interiorCells: number;
  cellSize: number;
  buildMs: number;
  bvhMs: number;
  compoundMs: number;
};
/** Bake the normalized model's node transforms once, without mutating its meshes. */
export function bakeGeometry(scene: Object3D): BufferGeometry {
  scene.updateMatrixWorld(true);
  const points: number[] = [];
  const point = new Vector3();
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const p = node.geometry.getAttribute("position"),
      index = node.geometry.getIndex();
    for (let i = 0; i < (index?.count ?? p.count); i++) {
      point
        .fromBufferAttribute(p, index ? index.getX(i) : i)
        .applyMatrix4(node.matrixWorld);
      points.push(point.x, point.y, point.z);
    }
  });
  return new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute(points, 3),
  );
}
function compoundBoxes(
  geometry: BufferGeometry,
  bounds: Box3,
  cell: number,
  closeBase: boolean,
  closeGapsM: number,
) {
  // Seams up to closeGapsM wide are closed by thickening the surface by `grow`
  // cells for the outside fill, then shrinking the outside back again.
  const grow = Math.round(closeGapsM / (2 * cell)),
    pad = grow + 1;
  const origin = bounds.min
    .clone()
    .divideScalar(cell)
    .floor()
    .multiplyScalar(cell)
    .addScalar(-cell * pad);
  const size = bounds.max
    .clone()
    .sub(origin)
    .divideScalar(cell)
    .ceil()
    .addScalar(pad + 1);
  const [nx, ny, nz] = size.toArray();
  const total = nx * ny * nz;
  if (!Number.isFinite(total) || total > 4000000 || cell < 0.01)
    throw new Error(
      "Choose a cell size of at least 1 cm and fewer than 4,000,000 cells.",
    );
  const cells = new Uint8Array(total),
    indexOf = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const position = geometry.getAttribute("position"),
    indices = geometry.getIndex();
  const triangle = new Triangle(),
    triangleBounds = new Box3(),
    voxel = new Box3();
  const start = new Vector3(),
    end = new Vector3();
  /** Visit every grid cell each triangle's bounds overlap. */
  const eachTriangleCell = (
    visit: (index: number, x: number, y: number, z: number) => void,
  ) => {
    for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
      triangle.a.fromBufferAttribute(position, indices ? indices.getX(i) : i);
      triangle.b.fromBufferAttribute(
        position,
        indices ? indices.getX(i + 1) : i + 1,
      );
      triangle.c.fromBufferAttribute(
        position,
        indices ? indices.getX(i + 2) : i + 2,
      );
      triangleBounds.setFromPoints([triangle.a, triangle.b, triangle.c]);
      start.copy(triangleBounds.min).sub(origin).divideScalar(cell).floor();
      end.copy(triangleBounds.max).sub(origin).divideScalar(cell).floor();
      for (let z = start.z; z <= end.z; z++)
        for (let y = start.y; y <= end.y; y++)
          for (let x = start.x; x <= end.x; x++)
            visit(indexOf(x, y, z), x, y, z);
    }
  };
  eachTriangleCell((index, x, y, z) => {
    if (cells[index] === 1) return;
    voxel.min.set(x, y, z).multiplyScalar(cell).add(origin);
    voxel.max.copy(voxel.min).addScalar(cell);
    if (voxel.intersectsTriangle(triangle)) cells[index] = 1;
  });
  let surfaceCells = 0;
  for (const v of cells) if (v === 1) surfaceCells++;
  // Flood-fill exterior. Closed regions become solid; open meshes can leak.
  const queue = new Int32Array(total);
  let head = 0,
    tail = 1;
  // A supporting plane blocks entry through the model's bottom. This fills
  // enclosed skirt/body voids while retaining air reachable from the sides/top.
  // Mark cells below it as exterior without queueing them into the flood fill.
  if (closeBase) {
    const baseY = Math.floor((bounds.min.y - origin.y) / cell);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < baseY; y++)
        for (let x = 0; x < nx; x++) cells[indexOf(x, y, z)] = 2;
  }
  // Cells within `grow` of the surface (3) block the outside fill for now.
  const around = (i: number, reach: number, visit: (j: number) => void) => {
    const x = i % nx,
      y = Math.floor(i / nx) % ny,
      z = Math.floor(i / (nx * ny));
    for (let dz = -reach; dz <= reach; dz++)
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const u = x + dx,
            v = y + dy,
            w = z + dz;
          if (u >= 0 && v >= 0 && w >= 0 && u < nx && v < ny && w < nz)
            visit(indexOf(u, v, w));
        }
  };
  if (grow > 0)
    for (let i = 0; i < total; i++)
      if (cells[i] === 1)
        around(i, grow, (j) => {
          if (cells[j] === 0) cells[j] = 3;
        });
  queue[0] = indexOf(0, ny - 1, 0);
  cells[queue[0]] = 2;
  const enqueue = (i: number) => {
    if (cells[i] === 0) {
      cells[i] = 2;
      queue[tail++] = i;
    }
  };
  while (head < tail) {
    const i = queue[head++],
      x = i % nx,
      y = Math.floor(i / nx) % ny,
      z = Math.floor(i / (nx * ny));
    if (x > 0) enqueue(i - 1);
    if (x < nx - 1) enqueue(i + 1);
    if (y > 0) enqueue(i - nx);
    if (y < ny - 1) enqueue(i + nx);
    if (z > 0) enqueue(i - nx * ny);
    if (z < nz - 1) enqueue(i + nx * ny);
  }
  // Shrink the outside back over the thickened cells, one layer per step, so
  // only seams stay closed; the real surface (1) is never crossed.
  for (let step = 0; step < grow; step++) {
    const reached: number[] = [];
    for (let i = 0; i < total; i++)
      if (cells[i] === 3) {
        let outside = false;
        around(i, 1, (j) => {
          outside ||= cells[j] === 2;
        });
        if (outside) reached.push(i);
      }
    for (const i of reached) cells[i] = 2;
  }
  for (let i = 0; i < total; i++) if (cells[i] === 3) cells[i] = 0;
  let interiorCells = 0;
  for (const v of cells) if (v === 0) interiorCells++;
  // A solid cell with open air above holds a real top surface somewhere inside
  // it. Find its true height (the highest triangle point clipped to the cell),
  // so resting surfaces are exact instead of rounded up to the grid line.
  const top = new Float64Array(total).fill(-Infinity);
  const exposed = (x: number, y: number, z: number) =>
    cells[indexOf(x, y, z)] === 1 &&
    (y === ny - 1 || cells[indexOf(x, y + 1, z)] === 2);
  eachTriangleCell((index, x, y, z) => {
    if (!exposed(x, y, z)) return;
    voxel.min.set(x, y, z).multiplyScalar(cell).add(origin);
    voxel.max.copy(voxel.min).addScalar(cell);
    top[index] = Math.max(top[index], clippedTop(triangle, voxel));
  });
  // Geometry that only touches a cell's floor needs no cap when the block below
  // already ends at that surface; over open space, keep the whole cell as before.
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = indexOf(x, y, z),
          floor = origin.y + y * cell;
        if (top[i] === -Infinity || top[i] - floor > MIN_CAP_M) continue;
        if (y === 0 || cells[indexOf(x, y - 1, z)] === 2) top[i] = floor + cell;
      }
  const used = new Uint8Array(total),
    boxes: Box3[] = [];
  // Exposed cells become caps of their own; everything below merges as before.
  for (let i = 0; i < total; i++) if (top[i] > -Infinity) used[i] = 1;
  const solid = (x: number, y: number, z: number) =>
    cells[indexOf(x, y, z)] !== 2 && !used[indexOf(x, y, z)];
  // Greedy merging turns the occupied grid into a small compound of solid boxes.
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (!solid(x, y, z)) continue;
        let dx = 1,
          dy = 1,
          dz = 1;
        while (x + dx < nx && solid(x + dx, y, z)) dx++;
        const row = (yy: number, zz: number) => {
          for (let xx = x; xx < x + dx; xx++)
            if (!solid(xx, yy, zz)) return false;
          return true;
        };
        while (y + dy < ny && row(y + dy, z)) dy++;
        const layer = (zz: number) => {
          for (let yy = y; yy < y + dy; yy++) if (!row(yy, zz)) return false;
          return true;
        };
        while (z + dz < nz && layer(z + dz)) dz++;
        for (let zz = z; zz < z + dz; zz++)
          for (let yy = y; yy < y + dy; yy++)
            for (let xx = x; xx < x + dx; xx++) used[indexOf(xx, yy, zz)] = 1;
        boxes.push(
          new Box3(
            new Vector3(x, y, z).multiplyScalar(cell).add(origin),
            new Vector3(x + dx, y + dy, z + dz)
              .multiplyScalar(cell)
              .add(origin),
          ),
        );
      }
  // Merge caps on the same layer whose real tops lie within CAP_MERGE_M, keeping
  // the highest, so a curved cushion doesn't become one box per cell.
  const capped = new Uint8Array(total);
  const cap = (x: number, y: number, z: number) =>
    top[indexOf(x, y, z)] > -Infinity && !capped[indexOf(x, y, z)];
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        if (!cap(x, y, z)) continue;
        let low = top[indexOf(x, y, z)],
          high = low;
        const fits = (xx: number, zz: number) => {
          if (!cap(xx, y, zz)) return false;
          const t = top[indexOf(xx, y, zz)];
          return (
            Math.max(high, t) - Math.min(low, t) <= CAP_MERGE_M &&
            ((low = Math.min(low, t)), (high = Math.max(high, t)), true)
          );
        };
        let dx = 1,
          dz = 1;
        while (x + dx < nx && fits(x + dx, z)) dx++;
        const row = (zz: number) => {
          const [l, h] = [low, high];
          for (let xx = x; xx < x + dx; xx++)
            if (!fits(xx, zz)) {
              [low, high] = [l, h];
              return false;
            }
          return true;
        };
        while (z + dz < nz && row(z + dz)) dz++;
        for (let zz = z; zz < z + dz; zz++)
          for (let xx = x; xx < x + dx; xx++) capped[indexOf(xx, y, zz)] = 1;
        if (high - (origin.y + y * cell) <= MIN_CAP_M) continue;
        boxes.push(
          new Box3(
            new Vector3(x, y, z).multiplyScalar(cell).add(origin),
            new Vector3((x + dx) * cell, 0, (z + dz) * cell)
              .add(origin)
              .setY(high),
          ),
        );
      }
  // Cells straddle the model's outer faces; nothing solid lies beyond them,
  // and float-noise slivers along those faces (under 10 µm) add nothing.
  const clippedBoxes = boxes
    .map((b) => b.intersect(bounds))
    .filter((b) => {
      const size = b.getSize(new Vector3());
      return Math.min(size.x, size.y, size.z) > 1e-5;
    });
  return { boxes: clippedBoxes, surfaceCells, interiorCells };
}
/** Caps whose real tops differ by at most this much merge into one box. */
const CAP_MERGE_M = 0.002;
/** Thinner caps add nothing: the block below already ends within 0.1 mm. */
const MIN_CAP_M = 0.0001;
const clipped: Vector3[] = Array.from({ length: 9 }, () => new Vector3()),
  scratch: Vector3[] = Array.from({ length: 9 }, () => new Vector3());
/** Highest point of a triangle clipped to an axis-aligned box (-Infinity if none). */
function clippedTop(t: Triangle, box: Box3): number {
  let poly = clipped,
    next = scratch,
    n = 3;
  poly[0].copy(t.a);
  poly[1].copy(t.b);
  poly[2].copy(t.c);
  for (const axis of ["x", "y", "z"] as const)
    for (const sign of [1, -1]) {
      const limit = sign > 0 ? box.max[axis] : box.min[axis];
      const inside = (p: Vector3) => sign * (limit - p[axis]) >= -1e-9;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const p = poly[i],
          q = poly[(i + 1) % n];
        if (inside(p)) next[m++].copy(p);
        if (inside(p) !== inside(q)) {
          const f = (limit - p[axis]) / (q[axis] - p[axis]);
          next[m++].copy(p).lerp(q, f);
        }
      }
      [poly, next] = [next, poly];
      n = m;
      if (!n) return -Infinity;
    }
  let high = -Infinity;
  for (let i = 0; i < n; i++) high = Math.max(high, poly[i].y);
  return Math.min(high, box.max.y);
}
export function buildProfile(
  geometry: BufferGeometry,
  cellSize = 0.04,
  options: { closeBase?: boolean; closeGapsM?: number } = {},
): Profile {
  if (!Number.isFinite(cellSize) || cellSize < 0.01)
    throw new Error("Invalid cell size.");
  const begin = performance.now();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone();
  if (bounds.isEmpty()) throw new Error("Model has no triangles.");
  const tree = new MeshBVH(geometry, { maxLeafTris: 10 });
  geometry.boundsTree = tree;
  const bvhMs = performance.now() - begin,
    gridBegin = performance.now();
  const compound = compoundBoxes(
    geometry,
    bounds,
    cellSize,
    options.closeBase ?? false,
    options.closeGapsM ?? 0,
  );
  return {
    geometry,
    tree,
    bounds,
    ...compound,
    triangles:
      (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) /
      3,
    cellSize,
    bvhMs,
    compoundMs: performance.now() - gridBegin,
    buildMs: performance.now() - begin,
  };
}
export function surfaceContact(profile: Profile, sphere: Sphere): boolean {
  return profile.tree.shapecast({
    intersectsBounds: (box) => box.intersectsSphere(sphere),
    intersectsTriangle: (triangle) => triangle.intersectsSphere(sphere),
  });
}
export function probeContacts(profile: Profile, sphere: Sphere) {
  return {
    box: profile.bounds.intersectsSphere(sphere),
    compound: profile.boxes.some((box) => box.intersectsSphere(sphere)),
    surface: surfaceContact(profile, sphere),
  };
}
export function rayContacts(
  profile: Profile,
  x: number,
  z: number,
  fromY: number,
) {
  const ray = new Ray(new Vector3(x, fromY, z), new Vector3(0, -1, 0)),
    point = new Vector3();
  const boxHit = ray.intersectBox(profile.bounds, point);
  const box = boxHit ? boxHit.y : null;
  let compound: number | null = null;
  for (const b of profile.boxes) {
    const hit = ray.intersectBox(b, point);
    if (hit && (compound === null || hit.y > compound)) compound = hit.y;
  }
  const hit = profile.tree.raycastFirst(ray, DoubleSide);
  return { box, compound, surface: hit ? hit.point.y : null };
}
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ];
export function benchmarkProfile(profile: Profile, count = 300) {
  const timings = {
    box: [] as number[],
    compound: [] as number[],
    surface: [] as number[],
  };
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const size = profile.bounds.getSize(new Vector3()),
    probes: Sphere[] = [];
  for (let i = 0; i < count; i++)
    probes.push(
      new Sphere(
        new Vector3(random(), random(), random())
          .multiply(size)
          .add(profile.bounds.min),
        0.025,
      ),
    );
  const checks = {
    box: (s: Sphere) => profile.bounds.intersectsSphere(s),
    compound: (s: Sphere) => profile.boxes.some((b) => b.intersectsSphere(s)),
    surface: (s: Sphere) => surfaceContact(profile, s),
  };
  const hits = { box: 0, compound: 0, surface: 0 };
  for (const key of ["box", "compound", "surface"] as const) {
    for (const probe of probes.slice(0, 30)) checks[key](probe);
    for (const probe of probes) {
      const t = performance.now();
      if (checks[key](probe)) hits[key]++;
      timings[key].push(performance.now() - t);
    }
  }
  const pairs = [];
  for (const factor of [1.2, 0.8, 0.5]) {
    const transform = new Matrix4().makeTranslation(size.x * factor, 0, 0),
      t = performance.now();
    const intersects = profile.tree.intersectsGeometry(
      profile.geometry,
      transform,
    );
    pairs.push({ offsetFactor: factor, intersects, ms: performance.now() - t });
  }
  return {
    samples: count,
    probeRadiusM: 0.025,
    methods: Object.fromEntries(
      Object.entries(timings).map(([name, values]) => [
        name,
        {
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          maxMs: Math.max(...values),
          hits: hits[name as keyof typeof hits],
        },
      ]),
    ),
    meshPairSurfaceIntersections: pairs,
  };
}
