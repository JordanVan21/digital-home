import type { SceneObject, Vec2 } from '@house/contracts';
import { assetOf, effectiveDimsOf, shapeLocalBoxes, worldSurfaces, type AssetLookup, type WorldSurface } from './body';
import { canRestOn, placementClassOf } from './config';
import { rotateXZ, yawFromQuat } from './math';
import { obbCorners, obbOf } from './obb';
import { distanceToBoundary, pointInPolygon } from './polygon';

/**
 * Stacking: which surface an object rests on. Surfaces come from assets (or category defaults):
 * table/desk/sideboard tops, each shelf board, sofa seats, bed tops, flat books, trays.
 */

export type SupportHit = {
  /** null = the floor. */
  ownerId: string | null;
  surfaceId: string;
  /** World height the object's base should sit at. */
  y: number;
};

/** Points this close to a face edge count as on it (baked faces come in 4 cm strips that share edges). */
export const EDGE_TOL_M = 0.002;

export type SupportContext = { assets?: AssetLookup; floorY?: number; fitToleranceM?: number };

/** Ids of `rootId` and everything resting on it (directly or transitively). */
export function subtreeIds(objects: readonly SceneObject[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of objects) {
      const p = o.placement?.parentId;
      if (p && out.has(p) && !out.has(o.id)) { out.add(o.id); grew = true; }
    }
  }
  return out;
}

/** True when `item` (at its current pose, base at `y`) fits on `surface`. */
export function fitsSurface(item: SceneObject, surface: WorldSurface, tol = 0.02): boolean {
  const corners = obbCorners(obbOf(item));
  const inside = corners.every((p) => pointInPolygon(p, surface.polygon, 0) || distanceToBoundary(p, surface.polygon) <= tol);
  if (!inside) return false;
  const h = effectiveDimsOf(item)[1];
  return surface.maxItemHeightM === undefined || h <= surface.maxItemHeightM + 1e-6;
}

/**
 * Codex's no-penetration rule for real top faces: resting on a face of `owner`'s baked shape is only
 * valid if the item's box doesn't intersect the rest of that shape (no vase inside a sofa's frame, no
 * book under a seat). Touching is fine. Owners without a shape always pass.
 */
export function clearOfShape(item: SceneObject, owner: SceneObject, assets?: AssetLookup, tol = 0.004): boolean {
  const boxes = shapeLocalBoxes(owner, assets);
  if (!boxes) return true;
  const ownerYaw = yawFromQuat(owner.transform.rotation);
  const [ox, oy, oz] = owner.transform.position;
  const [ix, iy, iz] = item.transform.position;
  const rel = rotateXZ([ix - ox, iz - oz], -ownerYaw);
  const [w, h, d] = effectiveDimsOf(item);
  const a = yawFromQuat(item.transform.rotation) - ownerYaw;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const ex = (c * w + s * d) / 2;
  const ez = (s * w + c * d) / 2;
  const y0 = iy - oy;
  const y1 = y0 + h;
  for (const b of boxes) {
    if (rel[0] - ex < b.max[0] - tol && rel[0] + ex > b.min[0] + tol && rel[1] - ez < b.max[2] - tol && rel[1] + ez > b.min[2] + tol
      && y0 < b.max[1] - tol && y1 > b.min[1] + tol) return false;
  }
  return true;
}

/**
 * Codex's resting rule (merge decision 4.2): the item's bottom centre lies on the surface (overhang is
 * fine — a leafy plant may stick out over a table), it fits a shelf gap, and it doesn't sink into the
 * owner's shape. `item` is at the candidate pose (base at the surface height).
 */
export function restsOn(item: SceneObject, surface: WorldSurface, owner?: SceneObject, assets?: AssetLookup): boolean {
  const c: Vec2 = [item.transform.position[0], item.transform.position[2]];
  if (!pointInPolygon(c, surface.polygon, EDGE_TOL_M)) return false;
  if (surface.maxItemHeightM !== undefined && effectiveDimsOf(item)[1] > surface.maxItemHeightM + 1e-6) return false;
  return !surface.shaped || !owner || clearOfShape(item, owner, assets);
}

/** All support surfaces in the scene that `item` may rest on (excluding itself and what rests on it). */
export function candidateSurfaces(objects: readonly SceneObject[], item: SceneObject, ctx: SupportContext = {}, exclude?: ReadonlySet<string>): WorldSurface[] {
  const own = subtreeIds(objects, item.id);
  const itemClass = placementClassOf(item, assetOf(item, ctx.assets));
  const out: WorldSurface[] = [];
  for (const o of objects) {
    if (own.has(o.id) || exclude?.has(o.id)) continue;
    if (!canRestOn(item.category, o.category, itemClass)) continue;
    out.push(...worldSurfaces(o, ctx.assets));
  }
  return out;
}

/**
 * Topmost surface under `point` (default: the item's footprint centre) at or below `maxY` that the
 * item fits on; otherwise the floor.
 */
export function findSupport(
  objects: readonly SceneObject[], item: SceneObject, ctx: SupportContext = {},
  opts: { point?: Vec2; maxY?: number; exclude?: ReadonlySet<string> } = {},
): SupportHit {
  const point = opts.point ?? [item.transform.position[0], item.transform.position[2]];
  let best: SupportHit = { ownerId: null, surfaceId: 'floor', y: ctx.floorY ?? 0 };
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const s of candidateSurfaces(objects, item, ctx, opts.exclude)) {
    if (opts.maxY !== undefined && s.y > opts.maxY + 0.005) continue;
    if (s.y <= best.y) continue;
    if (!pointInPolygon(point, s.polygon, EDGE_TOL_M)) continue;
    const probe = { ...item, transform: { ...item.transform, position: [point[0], s.y, point[1]] as [number, number, number] } };
    if (!restsOn(probe, s, byId.get(s.ownerId), ctx.assets)) continue;
    best = { ownerId: s.ownerId, surfaceId: s.id, y: s.y };
  }
  return best;
}

/**
 * Gravity: where an object comes to rest if released at its current pose. Null when it doesn't
 * settle (wall / ceiling items, or Float is on).
 */
export function settleTarget(objects: readonly SceneObject[], item: SceneObject, ctx: SupportContext = {}): SupportHit | null {
  const cls = placementClassOf(item, assetOf(item, ctx.assets));
  if (cls === 'wall' || cls === 'ceiling' || item.placement?.float) return null;
  return findSupport(objects, item, ctx, { maxY: item.transform.position[1] });
}

/** The surface of `parent` an object currently rests on (by height), if any. */
export function restingSurface(parent: SceneObject, item: SceneObject, assets?: AssetLookup, tol = 0.01): WorldSurface | undefined {
  const y = item.transform.position[1];
  const p: Vec2 = [item.transform.position[0], item.transform.position[2]];
  return worldSurfaces(parent, assets).find((s) => Math.abs(s.y - y) <= tol && pointInPolygon(p, s.polygon, 0.02));
}
