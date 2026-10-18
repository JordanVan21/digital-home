import type { SceneObject, Transform, Vec2 } from '@house/contracts';
import { assetOf, localBoxes, type LocalBox } from './body';
import { canRestOn, placementClassOf } from './config';
import { placementFor } from './editing';
import { rotateXZ, yawFromQuat } from './math';
import { pointInPolygon } from './polygon';
import { classOf, type RuleContext } from './rules';
import { findSupport, subtreeIds, type SupportHit } from './support';

/**
 * Contact (from the codex sandbox): the exposed top faces of every piece's compound collision
 * boxes, plus the floor. During a drag a piece is magnetically snapped onto the nearest face
 * within `SNAP_DISTANCE_M` of its base — a placement aid, never physics. Gravity is separate and
 * only runs when suggestions are accepted (`settleWithGravity`).
 */

export const SNAP_DISTANCE_M = 0.12;

export type ContactSurface = {
  /** null = the floor. */
  ownerId: string | null;
  /** World height of the face. */
  y: number;
  /** World XZ outline of the face (for the snap guide). */
  polygon: Vec2[];
  label: string;
};

type Rect = [number, number, number, number];
const EPS = 1e-7;

/** Remove the part of `rect` covered by `cut` (XZ), as up to four rectangles. */
function subtract(rect: Rect, cut: Rect): Rect[] {
  const [x0, z0, x1, z1] = rect;
  const a = Math.max(x0, cut[0]);
  const b = Math.max(z0, cut[1]);
  const c = Math.min(x1, cut[2]);
  const d = Math.min(z1, cut[3]);
  if (c - a <= EPS || d - b <= EPS) return [rect];
  return ([[x0, z0, a, z1], [c, z0, x1, z1], [a, z0, c, b], [a, d, c, z1]] as Rect[]).filter(([x, z, u, v]) => u - x > EPS && v - z > EPS);
}

/** Top faces of a compound not covered by a box resting directly above them (object-local m). */
export function exposedTops(boxes: readonly LocalBox[]): { rect: Rect; y: number }[] {
  const out: { rect: Rect; y: number }[] = [];
  for (const { min, max } of boxes) {
    let patches: Rect[] = [[min[0], min[2], max[0], max[2]]];
    for (const other of boxes) {
      if (other.min[1] > max[1] + EPS || other.max[1] <= max[1] + EPS) continue;
      patches = patches.flatMap((r) => subtract(r, [other.min[0], other.min[2], other.max[0], other.max[2]]));
      if (!patches.length) break;
    }
    for (const rect of patches) out.push({ rect, y: max[1] });
  }
  return out;
}

const topsCache = new WeakMap<SceneObject, ContactSurface[]>();

/** World-space exposed top faces of `obj` (cached per immutable object). */
export function topFaces(obj: SceneObject, assets?: RuleContext['assets']): ContactSurface[] {
  let faces = topsCache.get(obj);
  if (faces) return faces;
  const yaw = yawFromQuat(obj.transform.rotation);
  const [px, py, pz] = obj.transform.position;
  const toWorld = (x: number, z: number): Vec2 => {
    const [rx, rz] = rotateXZ([x, z], yaw);
    return [px + rx, pz + rz];
  };
  faces = exposedTops(localBoxes(obj, assets).boxes)
    .filter(({ rect }) => (rect[2] - rect[0]) > 0.02 && (rect[3] - rect[1]) > 0.02)
    .map(({ rect: [x0, z0, x1, z1], y }) => ({
      ownerId: obj.id,
      y: py + y,
      polygon: [toWorld(x0, z0), toWorld(x0, z1), toWorld(x1, z1), toWorld(x1, z0)],
      label: obj.displayName,
    }));
  topsCache.set(obj, faces);
  return faces;
}

/**
 * Faces `item` could snap onto: the floor, and exposed tops of pieces it may rest on (Jordan's
 * category rules), so a snap made while suggesting survives Accept. Never itself or what rests on it.
 */
export function contactSurfaces(ctx: RuleContext, objects: readonly SceneObject[], item: SceneObject): ContactSurface[] {
  const out: ContactSurface[] = [{ ownerId: null, y: ctx.shell.floor.elevationY, polygon: ctx.shell.floor.polygonXZ, label: 'Floor' }];
  const cls = placementClassOf(item, assetOf(item, ctx.assets));
  const own = subtreeIds(objects, item.id);
  for (const o of objects) {
    if (own.has(o.id) || !canRestOn(item.category, o.category, cls)) continue;
    out.push(...topFaces(o, ctx.assets));
  }
  return out;
}

/**
 * Magnetic contact while dragging or typing: snaps the base onto the nearest face under the
 * piece's centre within `distanceM`. Free states stay free. Wall and ceiling items never snap.
 */
export function snapToSurface(
  ctx: RuleContext, objects: readonly SceneObject[], item: SceneObject, transform: Transform, distanceM = SNAP_DISTANCE_M,
): { transform: Transform; surface?: ContactSurface } {
  const cls = classOf(ctx, item);
  if (item.locked || cls === 'wall' || cls === 'ceiling') return { transform };
  const [x, y, z] = transform.position;
  let best: ContactSurface | undefined;
  for (const s of contactSurfaces(ctx, objects, item)) {
    if (Math.abs(s.y - y) > distanceM || !pointInPolygon([x, z], s.polygon, 0)) continue;
    if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
  }
  return best ? { transform: { ...transform, position: [x, best.y, z] }, surface: best } : { transform };
}

/**
 * Gravity (rules on, at Accept): a piece comes to rest on the highest support surface beneath its
 * centre that it may rest on and fits (a slight overlap into a surface is pushed up onto it), or
 * the floor. Wall, ceiling and Float pieces don't fall.
 */
export function settleWithGravity(ctx: RuleContext, objects: readonly SceneObject[], item: SceneObject): { object: SceneObject; hit: SupportHit | null } {
  const cls = classOf(ctx, item);
  if (cls === 'wall' || cls === 'ceiling' || item.placement?.float) return { object: item, hit: null };
  const base = item.transform.position[1];
  const others = objects.filter((o) => o.id !== item.id);
  const hit = findSupport(others, item, { assets: ctx.assets, floorY: ctx.shell.floor.elevationY }, { maxY: base + SNAP_DISTANCE_M });
  const [x, , z] = item.transform.position;
  return {
    object: { ...item, transform: { ...item.transform, position: [x, hit.y, z] }, placement: placementFor(ctx, item, hit) },
    hit,
  };
}
