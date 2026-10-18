import type { Opening, RoomShell, SceneObject, SceneSpec, UUID, Wall } from "@house/contracts";
import { RawRoomScan, type RawObject, type RawSurface } from "./rawScan";

type P2 = [number, number];

export type ScanImportResult = {
  shell: RoomShell;
  scene: SceneSpec;
  /** Warnings never block import; each is user-presentable. */
  warnings: string[];
  /** RoomPlan world -> project-local: p_local = p_scan - translation (Y: floor). */
  scanToWorld: { translation: [number, number, number] };
};

export class ScanRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanRejectedError";
  }
}

export type AssetFit = { assetId: UUID; dimensionsM: [number, number, number]; displayName?: string };
export type NormalizeOptions = {
  /** Maps a normalized category + scanned envelope to a catalog asset; null keeps a neutral proxy. */
  resolveAsset?: (category: string, envelope: [number, number, number]) => AssetFit | null;
  now?: () => Date;
  newId?: () => UUID;
  /**
   * Where the room's local origin goes: "minCorner" (default) puts the floor's min
   * XZ corner at 0; "center" puts the floor's bounding-box center at 0, matching
   * the sandbox's centered fixture rooms, ground and shadows.
   */
  origin?: "minCorner" | "center";
  /**
   * "centered" (default): wall segments run along the scanned wall plane.
   * "inner": the scanned plane is the wall's room-facing surface; the segment moves
   * outward by half its thickness and extends to close the corners (how the
   * sandbox's fixture rooms are drawn), so pieces scanned flush to a wall stay
   * outside the drawn wall.
   */
  wallFaces?: "centered" | "inner";
  /**
   * Rotate the capture about Y so its longest wall runs along X (RoomPlan's frame
   * has an arbitrary heading). Default false keeps the capture heading.
   */
  alignToWalls?: boolean;
};

/** Pre-multiply a column-major 4x4 by a rotation about Y that maps heading `phi` onto +X. */
function rotateY(m: number[], phi: number): number[] {
  const c = Math.cos(phi), s = Math.sin(phi);
  const out = [...m];
  for (let col = 0; col < 4; col++) {
    const x = m[col * 4], z = m[col * 4 + 2];
    out[col * 4] = c * x + s * z;
    out[col * 4 + 2] = -s * x + c * z;
  }
  return out;
}

function alignedToWalls(raw: RawRoomScan): RawRoomScan {
  const longest = [...raw.walls].sort((a, b) => b.dimensions[0] - a.dimensions[0])[0];
  if (!longest) return raw;
  const phi = Math.atan2(longest.transform[2], longest.transform[0]);
  const turn = <T extends { transform: number[] }>(e: T): T => ({ ...e, transform: rotateY(e.transform, phi) });
  return {
    ...raw,
    walls: raw.walls.map(turn), doors: raw.doors.map(turn), windows: raw.windows.map(turn),
    openings: raw.openings.map(turn), floors: raw.floors.map(turn), objects: raw.objects.map(turn),
  };
}

/** RoomPlan object categories -> scene categories shared with the asset catalog. */
export const CATEGORY_MAP: Record<string, string> = {
  sofa: "sofa",
  chair: "chair",
  table: "table",
  bed: "bed",
  storage: "storage",
  television: "television",
  fireplace: "fireplace",
  refrigerator: "refrigerator",
  stove: "stove",
  oven: "oven",
  dishwasher: "dishwasher",
  washerDryer: "washer_dryer",
  sink: "sink",
  toilet: "toilet",
  bathtub: "bathtub",
  stairs: "stairs",
};

const MIN_AREA_M2 = 1.5;
const MIN_WALL_M = 0.3;
const SNAP_M = 0.6; // max gap between consecutive walls / wall-opening distance
const DEFAULT_THICKNESS_M = 0.12;
const DEFAULT_WALL_HEIGHT_M = 2.5;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Column-major helpers. */
const translation = (m: number[]): [number, number, number] => [m[12], m[13], m[14]];
const xAxis = (m: number[]): [number, number, number] => [m[0], m[1], m[2]];

function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

/** Two proper (non-adjacent) edges crossing => self-intersecting polygon. */
function selfIntersects(poly: P2[]): boolean {
  const n = poly.length;
  const ccw = (a: P2, b: P2, c: P2) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
      if (ccw(a, c, d) * ccw(b, c, d) < 0 && ccw(a, b, c) * ccw(a, b, d) < 0) return true;
    }
  }
  return false;
}

function lineIntersection(a: P2, b: P2, c: P2, d: P2): P2 | null {
  const r: P2 = [b[0] - a[0], b[1] - a[1]];
  const s: P2 = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

type Seg = { raw: RawSurface; a: P2; b: P2; baseY: number; topY: number };

function wallSegment(w: RawSurface): Seg {
  const c = translation(w.transform);
  const ax = xAxis(w.transform);
  const half = w.dimensions[0] / 2;
  const len = Math.hypot(ax[0], ax[2]) || 1;
  const dx = (ax[0] / len) * half;
  const dz = (ax[2] / len) * half;
  return {
    raw: w,
    a: [c[0] - dx, c[2] - dz],
    b: [c[0] + dx, c[2] + dz],
    baseY: c[1] - w.dimensions[1] / 2,
    topY: c[1] + w.dimensions[1] / 2,
  };
}

/**
 * Orders wall segments into a closed loop and solves each corner as the
 * intersection of adjacent wall lines (RoomPlan walls rarely meet exactly).
 * Returns the oriented segments (a->b following the loop) and corner points.
 */
function chainWalls(segs: Seg[]): { ordered: Seg[]; corners: P2[]; closed: boolean } {
  const remaining = [...segs].sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
  const first = remaining.shift()!;
  const ordered: Seg[] = [first];
  let tail = first.b;
  while (remaining.length) {
    let best = -1, bestFlip = false, bestD = Infinity;
    remaining.forEach((s, i) => {
      const da = dist(tail, s.a), db = dist(tail, s.b);
      if (da < bestD) { best = i; bestD = da; bestFlip = false; }
      if (db < bestD) { best = i; bestD = db; bestFlip = true; }
    });
    if (best < 0 || bestD > SNAP_M) break;
    const [s] = remaining.splice(best, 1);
    const oriented = bestFlip ? { ...s, a: s.b, b: s.a } : s;
    ordered.push(oriented);
    tail = oriented.b;
  }
  const closed = remaining.length === 0 && dist(tail, first.a) <= SNAP_M;
  const n = ordered.length;
  const corners: P2[] = ordered.map((cur, i) => {
    const prev = ordered[(i + n - 1) % n];
    const hit = lineIntersection(prev.a, prev.b, cur.a, cur.b);
    const mid: P2 = [(prev.b[0] + cur.a[0]) / 2, (prev.b[1] + cur.a[1]) / 2];
    return hit && dist(hit, mid) <= 1.0 ? hit : mid;
  });
  return { ordered, corners, closed };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function normalizeRoomScan(input: unknown, options: NormalizeOptions = {}): ScanImportResult {
  const parsed = RawRoomScan.safeParse(input);
  if (!parsed.success) {
    throw new ScanRejectedError(`Scan file is corrupt or unsupported: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const raw = options.alignToWalls ? alignedToWalls(parsed.data) : parsed.data;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const warnings: string[] = [];
  const stableId = (id: string) => (isUuid(id) ? id.toLowerCase() : newId());

  const segs = raw.walls.map(wallSegment).filter((s) => dist(s.a, s.b) >= MIN_WALL_M);
  if (raw.walls.length - segs.length > 0) warnings.push(`Dropped ${raw.walls.length - segs.length} wall fragment(s) shorter than ${MIN_WALL_M} m.`);
  if (segs.length < 3) throw new ScanRejectedError("Scan has fewer than 3 usable walls. Rescan, walking the room's full perimeter.");

  // --- Floor polygon -------------------------------------------------------
  const { ordered, corners, closed } = chainWalls(segs);
  let polygon: P2[];
  if (closed && ordered.length >= 3) {
    polygon = corners;
  } else {
    // Walls didn't form a loop: fall back to a floor outline from RoomPlan, if any.
    const floor = raw.floors.find((f) => (f.polygonCorners?.length ?? 0) >= 3);
    if (!floor?.polygonCorners) throw new ScanRejectedError("Walls do not form a closed room. Rescan, overlapping where you started.");
    // RoomPlan floor corners are surface-local (verified on real scans): map them
    // through the floor's column-major transform into the capture frame first.
    const m = floor.transform;
    polygon = floor.polygonCorners.map(([x, y, z]): P2 => [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]);
    warnings.push("Wall outline was incomplete; used the scanned floor outline instead.");
  }
  if (selfIntersects(polygon)) throw new ScanRejectedError("Room outline crosses itself. Rescan the room.");
  let area = signedArea(polygon);
  if (Math.abs(area) < MIN_AREA_M2) throw new ScanRejectedError(`Scanned floor area (${Math.abs(area).toFixed(1)} m²) is too small to be a room.`);
  if (area < 0) { polygon = [...polygon].reverse(); area = -area; } // contract: positive XZ shoelace area, like the fixtures

  // --- Frame: RoomPlan world is already meters / Y-up / right-handed, so the
  // only change is translating the floor's min corner and base height to 0.
  const floorY = median(ordered.map((s) => s.baseY));
  const xs = polygon.map((p) => p[0]), zs = polygon.map((p) => p[1]);
  const centered = options.origin === "center";
  const originX = centered ? (Math.min(...xs) + Math.max(...xs)) / 2 : Math.min(...xs);
  const originZ = centered ? (Math.min(...zs) + Math.max(...zs)) / 2 : Math.min(...zs);
  const toLocal = (p: P2): P2 => [round(p[0] - originX), round(p[1] - originZ)];
  const localPolygon = polygon.map(toLocal);

  // --- Walls: re-derive endpoints from solved corners when walls form the loop.
  const walls: Wall[] = [];
  const wallSources: RawSurface[] = [];
  if (closed && ordered.length >= 3) {
    ordered.forEach((seg, i) => {
      walls.push({
        id: stableId(seg.raw.id),
        fromXZ: toLocal(corners[i]),
        toXZ: toLocal(corners[(i + 1) % ordered.length]),
        heightM: round(Math.max(seg.topY - seg.baseY, 0.5) || DEFAULT_WALL_HEIGHT_M),
        thicknessM: seg.raw.dimensions[2] > 0.02 ? round(seg.raw.dimensions[2]) : DEFAULT_THICKNESS_M,
      });
      wallSources.push(seg.raw);
    });
  } else {
    for (const seg of segs) {
      walls.push({
        id: stableId(seg.raw.id),
        fromXZ: toLocal(seg.a),
        toXZ: toLocal(seg.b),
        heightM: round(seg.topY - seg.baseY),
        thicknessM: seg.raw.dimensions[2] > 0.02 ? round(seg.raw.dimensions[2]) : DEFAULT_THICKNESS_M,
      });
      wallSources.push(seg.raw);
    }
  }
  if (options.wallFaces === "inner") {
    for (const wall of walls) {
      const [ax, az] = wall.fromXZ, [bx, bz] = wall.toXZ;
      const len = Math.hypot(bx - ax, bz - az);
      const u: P2 = [(bx - ax) / len, (bz - az) / len];
      let n: P2 = [u[1], -u[0]];
      const mid: P2 = [(ax + bx) / 2 + n[0] * 0.05, (az + bz) / 2 + n[1] * 0.05];
      if (pointInPolygon(mid, localPolygon)) n = [-n[0], -n[1]];
      const h = wall.thicknessM / 2;
      wall.fromXZ = [round(ax - u[0] * h + n[0] * h), round(az - u[1] * h + n[1] * h)];
      wall.toXZ = [round(bx + u[0] * h + n[0] * h), round(bz + u[1] * h + n[1] * h)];
    }
  }
  const ceilingHeightM = round(median(walls.map((w) => w.heightM)));

  // --- Openings ------------------------------------------------------------
  const openings: Opening[] = [];
  const addOpening = (s: RawSurface, kind: "door" | "window") => {
    const c = translation(s.transform);
    const p = toLocal([c[0], c[2]]);
    let best: { wall: Wall; along: number; off: number } | null = null;
    for (const wall of walls) {
      const [ax, az] = wall.fromXZ, [bx, bz] = wall.toXZ;
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const along = (p[0] - ax) * ux + (p[1] - az) * uz;
      const off = Math.abs((p[0] - ax) * -uz + (p[1] - az) * ux);
      if (along < -SNAP_M || along > len + SNAP_M) continue;
      if (!best || off < best.off) best = { wall, along, off };
    }
    if (!best || best.off > SNAP_M) {
      warnings.push(`A scanned ${kind} was not near any wall and was ignored.`);
      return;
    }
    const wallLen = dist(best.wall.fromXZ, best.wall.toXZ);
    const width = Math.min(Math.max(s.dimensions[0], 0.2), wallLen);
    const offset = Math.min(Math.max(best.along - width / 2, 0), wallLen - width);
    const bottom = Math.max(c[1] - s.dimensions[1] / 2 - floorY, 0);
    const height = Math.min(Math.max(s.dimensions[1], 0.2), best.wall.heightM - bottom);
    if (height <= 0) return;
    openings.push({
      id: stableId(s.id),
      wallId: best.wall.id,
      kind,
      offsetM: round(offset),
      widthM: round(width),
      bottomM: round(bottom),
      heightM: round(height),
    });
  };
  raw.doors.forEach((s) => addOpening(s, "door"));
  raw.windows.forEach((s) => addOpening(s, "window"));
  // Unframed openings carry no door/window distinction; treat as doorways.
  raw.openings.forEach((s) => addOpening(s, "door"));

  const shellId = newId();
  const shell: RoomShell = {
    id: shellId,
    sourceScanId: raw.scanId,
    coordinateVersion: 1,
    floor: { polygonXZ: localPolygon, elevationY: 0 },
    walls,
    openings,
    ceilingHeightM,
  };

  // --- Objects -------------------------------------------------------------
  const objects: SceneObject[] = [];
  const unknownCategories = new Set<string>();
  for (const o of raw.objects) {
    const mapped = CATEGORY_MAP[o.category];
    if (!mapped) unknownCategories.add(o.category);
    const category = mapped ?? "unknown";
    objects.push(toSceneObject(o, category, floorY, [originX, originZ], options));
  }
  if (unknownCategories.size) warnings.push(`Unrecognized object classes shown as placeholders: ${[...unknownCategories].join(", ")}.`);
  const outside = objects.filter((o) => !pointInPolygon([o.transform.position[0], o.transform.position[2]], localPolygon));
  if (outside.length) warnings.push(`${outside.length} scanned object(s) sit outside the room outline; check their positions.`);
  const lowConfidence = raw.objects.filter((o) => o.confidence === "low").length;
  if (lowConfidence) warnings.push(`${lowConfidence} object(s) were detected with low confidence.`);

  const scene: SceneSpec = {
    schemaVersion: 1,
    id: newId(),
    roomId: newId(),
    shellId,
    revision: 0,
    objects,
    lightingPreset: "golden_hour",
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
  };
  return { shell, scene, warnings, scanToWorld: { translation: [round(originX), round(floorY), round(originZ)] } };

  function toSceneObject(o: RawObject, category: string, floorY: number, origin: P2, opts: NormalizeOptions): SceneObject {
    const c = translation(o.transform);
    const ax = xAxis(o.transform);
    // Three yaw θ maps local +X to (cosθ, 0, -sinθ); recover θ from the scanned X axis.
    const yaw = Math.atan2(-ax[2], ax[0]);
    const envelope: [number, number, number] = [
      Math.max(o.dimensions[0], 0.05), Math.max(o.dimensions[1], 0.05), Math.max(o.dimensions[2], 0.05),
    ];
    const fit = opts.resolveAsset?.(category, envelope) ?? null;
    const dims = fit?.dimensionsM ?? envelope;
    return {
      id: stableId(o.id),
      assetId: fit?.assetId ?? null,
      category,
      transform: {
        // Scene objects are positioned at their base (see fixtures), RoomPlan at the box center.
        position: [round(c[0] - origin[0]), round(Math.max(c[1] - envelope[1] / 2 - floorY, 0)), round(c[2] - origin[1])],
        rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        scale: [1, 1, 1],
      },
      dimensionsM: dims,
      locked: false,
      source: "roomplan_approximation",
      displayName: fit?.displayName ?? humanize(o.category),
      ownership: "existing",
      placement: { support: "floor" },
    };
  }
}

function humanize(roomPlanCategory: string): string {
  const spaced = roomPlanCategory.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
