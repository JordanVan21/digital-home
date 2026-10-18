import type { CollisionKind, RoomShell, SceneObject, Vec2, Vec3 } from '@house/contracts';
import { assetOf, worldBoxes, type AssetLookup } from './body';
import { DEFAULT_RULE_CONFIG, placementClassOf, type RuleConfig } from './config';
import { add2, len2, scale2, sub2 } from './math';
import { obbAabbXZ, obbMtvXZ, obbPenetration3D, translateObb, type OBB } from './obb';
import { wallFrames } from './shell';

/**
 * Height-aware collision: compound yaw-aligned boxes per object (profiles), a pair matrix
 * (flat never collides, soft only against solids, parent/child chains exempt), and
 * slide-don't-stick resolution by minimum translation vectors.
 */
export type Body = {
  id: string;
  label: string;
  kind: CollisionKind;
  boxes: OBB[];
  min: Vec3;
  max: Vec3;
  /** True for walls (immutable shell). */
  wall?: boolean;
  /** True for wall-mounted items (art, wall TVs, shelves on the wall). */
  wallMounted?: boolean;
};

/**
 * Collision exceptions (from the codex sandbox's `occupancyRules`), as one explicit table on top of
 * the profile matrix below. Wall-mounted items and furniture never collide (a picture may hang over a
 * cabinet); wall items still collide with each other. Rugs never collide (profile `flat`).
 */
export const COLLISION_EXCEPTIONS = {
  wallMountedVsFurniture: true,
} as const;

const isWallMounted = (obj: SceneObject, assets?: AssetLookup) => placementClassOf(obj, assetOf(obj, assets)) === 'wall';

function boundsOf(boxes: OBB[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const a = obbAabbXZ(b);
    min[0] = Math.min(min[0], a.min[0]); min[1] = Math.min(min[1], b.yMin); min[2] = Math.min(min[2], a.min[1]);
    max[0] = Math.max(max[0], a.max[0]); max[1] = Math.max(max[1], b.yMax); max[2] = Math.max(max[2], a.max[1]);
  }
  return { min, max };
}

const NO_ASSETS: AssetLookup = () => undefined;
const bodyCache = new WeakMap<AssetLookup, WeakMap<SceneObject, Body>>();

/** Collision body of an object (cached per immutable object). */
export function bodyOf(obj: SceneObject, assets?: AssetLookup): Body {
  const key = assets ?? NO_ASSETS;
  let cache = bodyCache.get(key);
  if (!cache) bodyCache.set(key, (cache = new WeakMap()));
  let b = cache.get(obj);
  if (!b) {
    const { kind, boxes } = worldBoxes(obj, assets);
    b = { id: obj.id, label: obj.displayName || obj.category.replace(/_/g, ' '), kind, boxes, ...boundsOf(boxes), ...(isWallMounted(obj, assets) ? { wallMounted: true } : {}) };
    cache.set(obj, b);
  }
  return b;
}

/** Bodies for a moved/rotated copy of an object (not cached). */
export function bodyAt(obj: SceneObject, assets?: AssetLookup): Body {
  const { kind, boxes } = worldBoxes(obj, assets);
  return { id: obj.id, label: obj.displayName || obj.category, kind, boxes, ...boundsOf(boxes), ...(isWallMounted(obj, assets) ? { wallMounted: true } : {}) };
}

const wallCache = new WeakMap<RoomShell, Body[]>();

/** Walls as solid boxes extruded outward from the floor polygon (extended past their ends to seal corners). */
export function wallBodies(shell: RoomShell): Body[] {
  let walls = wallCache.get(shell);
  if (!walls) {
    walls = wallFrames(shell).map((f) => {
      const T = Math.max(f.wall.thicknessM, 0.1);
      const mid = add2(add2(f.from, scale2(f.dir, f.length / 2)), scale2(f.inward, -T / 2));
      const box: OBB = { center: mid, u: f.dir, v: f.inward, halfW: f.length / 2 + T, halfD: T / 2, yMin: -1, yMax: f.wall.heightM + 1 };
      return { id: `wall:${f.wall.id}`, label: 'wall', kind: 'solid' as const, boxes: [box], ...boundsOf([box]), wall: true };
    });
    wallCache.set(shell, walls);
  }
  return walls;
}

export function translateBody(b: Body, dx: number, dz: number, dy = 0): Body {
  return {
    ...b,
    boxes: b.boxes.map((o) => translateObb(o, dx, dz, dy)),
    min: [b.min[0] + dx, b.min[1] + dy, b.min[2] + dz],
    max: [b.max[0] + dx, b.max[1] + dy, b.max[2] + dz],
  };
}

const aabbOverlap = (a: Body, b: Body, pad = 0) =>
  a.min[0] - pad < b.max[0] && a.max[0] + pad > b.min[0]
  && a.min[1] < b.max[1] && a.max[1] > b.min[1]
  && a.min[2] - pad < b.max[2] && a.max[2] + pad > b.min[2];

export type PairContact = {
  /** Max 3D penetration across box pairs (for violations). */
  depth: number;
  /** Horizontal push for body A that clears the deepest box pair. */
  push: { depth: number; dir: Vec2 } | null;
};

/**
 * Contact between two bodies honouring the profile matrix. Caller handles parent/child exemption.
 * Returns null when they don't collide (touching within tolerance is not a collision).
 */
export function bodyContact(a: Body, b: Body, cfg: RuleConfig = DEFAULT_RULE_CONFIG): PairContact | null {
  if (a.kind === 'flat' || b.kind === 'flat' || a.kind === 'none' || b.kind === 'none') return null;
  if (COLLISION_EXCEPTIONS.wallMountedVsFurniture && !a.wall && !b.wall && !!a.wallMounted !== !!b.wallMounted) return null;
  if (!aabbOverlap(a, b)) return null;
  const allowance = a.kind === 'soft' && b.kind === 'soft' ? cfg.softOverlapM : cfg.contactToleranceM;
  let depth = 0;
  let push: PairContact['push'] = null;
  for (const ba of a.boxes) {
    for (const bb of b.boxes) {
      const p = obbPenetration3D(ba, bb);
      if (!p || p.depth <= allowance) continue;
      depth = Math.max(depth, p.depth);
      const m = obbMtvXZ(ba, bb);
      if (m && (!push || m.depth > push.depth)) push = m;
    }
  }
  return depth > 0 ? { depth, push } : null;
}

export type Blocker = { movingId: string; otherId: string; label: string; wall: boolean };

/**
 * Push a set of moving bodies (already at `offset`) out of obstacles with horizontal MTVs.
 * Returns the resolved offset, or null if it can't be resolved in `iters` steps.
 */
function pushOut(moving: Body[], obstacles: Body[], offset: Vec2, cfg: RuleConfig, iters: number, hits: Map<string, Blocker>): Vec2 | null {
  let pos = offset;
  for (let k = 0; k < iters; k++) {
    let deepest: { push: { depth: number; dir: Vec2 }; blocker: Blocker } | null = null;
    for (const m of moving) {
      const mb = translateBody(m, pos[0], pos[1]);
      for (const o of obstacles) {
        const c = bodyContact(mb, o, cfg);
        if (!c?.push) continue;
        if (!deepest || c.push.depth > deepest.push.depth) {
          deepest = { push: c.push, blocker: { movingId: m.id, otherId: o.id, label: o.label, wall: !!o.wall } };
        }
      }
    }
    if (!deepest) return pos;
    hits.set(deepest.blocker.otherId, deepest.blocker);
    pos = add2(pos, scale2(deepest.push.dir, deepest.push.depth + cfg.contactToleranceM * 0.5));
  }
  return null;
}

export type ResolveResult = { offset: Vec2; blockers: Blocker[]; blocked: boolean };

/**
 * Slide, don't stick: move `moving` bodies (at their start pose) from offset `from` toward `to`
 * in small sub-steps, pushing out of obstacles each step. Thin obstacles can't be tunnelled
 * through, and the result ends against an obstacle's edge rather than inside it.
 */
export function resolveTranslation(
  moving: Body[], obstacles: Body[], from: Vec2, to: Vec2,
  opts: { cfg?: RuleConfig; stepM?: number; iters?: number } = {},
): ResolveResult {
  const cfg = opts.cfg ?? DEFAULT_RULE_CONFIG;
  const step = opts.stepM ?? 0.04;
  const iters = opts.iters ?? 8;
  const total = sub2(to, from);
  const steps = Math.min(60, Math.max(1, Math.ceil(len2(total) / step)));
  const hits = new Map<string, Blocker>();
  // If the start itself overlaps (e.g. the user dropped an item into something), resolve it first.
  let cur = pushOut(moving, obstacles, from, cfg, iters, hits) ?? from;
  let blocked = false;
  for (let i = 1; i <= steps; i++) {
    const target = add2(from, scale2(total, i / steps));
    // Keep the accumulated slide: aim from the current position toward this sub-target.
    const aim = add2(cur, sub2(target, i === 1 ? from : add2(from, scale2(total, (i - 1) / steps))));
    const next = pushOut(moving, obstacles, aim, cfg, iters, hits);
    if (!next) { blocked = true; break; }
    cur = next;
  }
  return { offset: cur, blockers: [...hits.values()], blocked };
}

/**
 * Rotation into an obstacle: try to push the rotated bodies clear (≤ maxPushM). Null = blocked.
 */
export function resolveRotation(
  rotated: Body[], obstacles: Body[], opts: { cfg?: RuleConfig; maxPushM?: number } = {},
): { offset: Vec2; blockers: Blocker[] } | null {
  const hits = new Map<string, Blocker>();
  const off = pushOut(rotated, obstacles, [0, 0], opts.cfg ?? DEFAULT_RULE_CONFIG, 10, hits);
  if (!off || len2(off) > (opts.maxPushM ?? 0.3)) return null;
  return { offset: off, blockers: [...hits.values()] };
}

/**
 * Uniform-grid broad-phase over cached bodies. `sync` is incremental: unchanged bodies (same
 * object identity) are skipped, so only edited objects are re-binned.
 */
export class GridBroadPhase {
  private readonly cells = new Map<string, Set<string>>();
  private readonly entries = new Map<string, { body: Body; keys: string[] }>();

  constructor(private readonly cell = 1) {}

  private keysFor(b: Body): string[] {
    const keys: string[] = [];
    const x0 = Math.floor(b.min[0] / this.cell);
    const x1 = Math.floor(b.max[0] / this.cell);
    const z0 = Math.floor(b.min[2] / this.cell);
    const z1 = Math.floor(b.max[2] / this.cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(`${x},${z}`);
    return keys;
  }

  private remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    for (const k of e.keys) this.cells.get(k)?.delete(id);
    this.entries.delete(id);
  }

  sync(bodies: Iterable<Body>): void {
    const seen = new Set<string>();
    for (const b of bodies) {
      seen.add(b.id);
      const e = this.entries.get(b.id);
      if (e?.body === b) continue;
      this.remove(b.id);
      const keys = this.keysFor(b);
      for (const k of keys) {
        let s = this.cells.get(k);
        if (!s) this.cells.set(k, (s = new Set()));
        s.add(b.id);
      }
      this.entries.set(b.id, { body: b, keys });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  query(min: Vec3, max: Vec3, pad = 0.05): Body[] {
    const probe: Body = { id: '', label: '', kind: 'solid', boxes: [], min: [min[0] - pad, min[1], min[2] - pad], max: [max[0] + pad, max[1], max[2] + pad] };
    const out = new Map<string, Body>();
    for (const k of this.keysFor(probe)) {
      for (const id of this.cells.get(k) ?? []) {
        const b = this.entries.get(id)!.body;
        if (!out.has(id) && aabbOverlap(b, probe)) out.set(id, b);
      }
    }
    return [...out.values()];
  }

  get size() {
    return this.entries.size;
  }
}

/** Union bounds of several bodies (for a group query). */
export function boundsOfBodies(bodies: Body[]): { min: Vec3; max: Vec3 } {
  return boundsOf(bodies.flatMap((b) => b.boxes));
}
