import { BufferGeometry, EdgesGeometry, Float32BufferAttribute } from "three";
type Blocks = number[][][];
const cache = new WeakMap<Blocks, Map<string, Float32Array>>();
/** Outline corners snap to this real-world step: exact collider tops vary by
 * fractions of a millimetre, which would otherwise explode the outline grid. */
export const OUTLINE_STEP_M = 0.005;
/** Exterior crease edges of the union, with shared faces, coplanar seams and
 * sealed internal cavities removed. Cached in normalized asset coordinates.
 * With the model's size, corners snap to OUTLINE_STEP_M along each axis. */
export function compoundExteriorPositions(
  boxes: Blocks,
  dimensionsM?: readonly number[],
): Float32Array {
  const step = [0, 1, 2].map((i) =>
    dimensionsM ? OUTLINE_STEP_M / dimensionsM[i] : 1e-8,
  );
  const key = step.join(",");
  let byStep = cache.get(boxes);
  if (!byStep) cache.set(boxes, (byStep = new Map()));
  const cached = byStep.get(key);
  if (cached) return cached;
  const round = (n: number, axis: number) =>
    Math.min(1, Math.max(0, Math.round(n / step[axis]) * step[axis]));
  const coords = [0, 1, 2].map((axis) =>
    [
      ...new Set(
        boxes.flatMap((b) => [
          round(b[0][axis], axis),
          round(b[1][axis], axis),
        ]),
      ),
    ].sort((a, b) => a - b),
  );
  const [nx, ny, nz] = coords.map((c) => c.length - 1),
    total = nx * ny * nz;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 2_000_000)
    throw new Error("Compound outline exceeds the supported grid size.");
  const index = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const occupied = new Uint8Array(total),
    exterior = new Uint8Array(total),
    queue = new Int32Array(total);
  const lookup = coords.map((c) => new Map(c.map((n, i) => [n, i])));
  for (const [min, max] of boxes) {
    const lo = min.map((n, i) => lookup[i].get(round(n, i))!),
      hi = max.map((n, i) => lookup[i].get(round(n, i))!);
    for (let z = lo[2]; z < hi[2]; z++)
      for (let y = lo[1]; y < hi[1]; y++)
        for (let x = lo[0]; x < hi[0]; x++) occupied[index(x, y, z)] = 1;
  }
  let head = 0,
    tail = 0;
  const add = (i: number) => {
    if (!occupied[i] && !exterior[i]) {
      exterior[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (
          x === 0 ||
          x === nx - 1 ||
          y === 0 ||
          y === ny - 1 ||
          z === 0 ||
          z === nz - 1
        )
          add(index(x, y, z));
  const stride = [1, nx, nx * ny],
    dims = [nx, ny, nz];
  while (head < tail) {
    const i = queue[head++],
      cell = [i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny))];
    for (let axis = 0; axis < 3; axis++)
      for (const side of [-1, 1])
        if (cell[axis] + side >= 0 && cell[axis] + side < dims[axis])
          add(i + side * stride[axis]);
  }
  const triangles: number[] = [];
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = index(x, y, z);
        if (!occupied[i]) continue;
        const cell = [x, y, z];
        for (let axis = 0; axis < 3; axis++)
          for (const side of [-1, 1]) {
            const next = cell[axis] + side;
            if (
              next >= 0 &&
              next < dims[axis] &&
              !exterior[i + side * stride[axis]]
            )
              continue;
            const u = (axis + 1) % 3,
              v = (axis + 2) % 3;
            const corners = [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ].map(([a, b]) => {
              const p = [0, 0, 0];
              p[axis] = coords[axis][cell[axis] + (side > 0 ? 1 : 0)];
              p[u] = coords[u][cell[u] + a];
              p[v] = coords[v][cell[v] + b];
              return p;
            });
            for (const corner of side > 0
              ? [0, 1, 2, 0, 2, 3]
              : [0, 2, 1, 0, 3, 2])
              triangles.push(...corners[corner]);
          }
      }
  const surface = new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute(triangles, 3),
  );
  const edges = new EdgesGeometry(surface, 1),
    positions = edges.getAttribute("position");
  // Join collinear boundary fragments left by coordinate compression.
  const runs = new Map<
    string,
    { axis: number; point: number[]; intervals: [number, number][] }
  >();
  for (let i = 0; i < positions.count; i += 2) {
    const a = [positions.getX(i), positions.getY(i), positions.getZ(i)],
      b = [positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1)];
    const axis = a.findIndex((n, k) => Math.abs(n - b[k]) > 1e-7);
    if (axis < 0) continue;
    const key = `${axis}:${a
      .filter((_, k) => k !== axis)
      .map((n) => Math.round(n * 1e6))
      .join(":")}`;
    let run = runs.get(key);
    if (!run) {
      run = { axis, point: a, intervals: [] };
      runs.set(key, run);
    }
    run.intervals.push([
      Math.min(a[axis], b[axis]),
      Math.max(a[axis], b[axis]),
    ]);
  }
  const result: number[] = [];
  for (const { axis, point, intervals } of runs.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    let [start, end] = intervals[0];
    const emit = () => {
      const a = [...point],
        b = [...point];
      a[axis] = start;
      b[axis] = end;
      result.push(...a, ...b);
    };
    for (const [lo, hi] of intervals.slice(1))
      if (lo <= end + 1e-6) end = Math.max(end, hi);
      else {
        emit();
        start = lo;
        end = hi;
      }
    emit();
  }
  surface.dispose();
  edges.dispose();
  const output = new Float32Array(result);
  byStep.set(key, output);
  return output;
}
