import type { SceneObject, Vec2 } from '@house/contracts';
import { assetOf, effectiveDimsOf, worldSurfaces, type AssetLookup, type WorldSurface } from './body';
import { canRestOn, placementClassOf } from './config';
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
  const tol = ctx.fitToleranceM ?? 0.02;
  let best: SupportHit = { ownerId: null, surfaceId: 'floor', y: ctx.floorY ?? 0 };
  for (const s of candidateSurfaces(objects, item, ctx, opts.exclude)) {
    if (opts.maxY !== undefined && s.y > opts.maxY + 0.005) continue;
    if (s.y <= best.y) continue;
    if (!pointInPolygon(point, s.polygon, 0)) continue;
    const probe = { ...item, transform: { ...item.transform, position: [point[0], s.y, point[1]] as [number, number, number] } };
    if (!fitsSurface(probe, s, tol)) continue;
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
