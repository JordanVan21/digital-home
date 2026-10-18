import type { Placement, RoomShell, SceneObject, SceneOp, SceneSpec, Tilt, Transform, Vec2, Vec3 } from '@house/contracts';
import { effectiveDimsOf, worldSurfaces } from './body';
import { supportForClass } from './config';
import { makeTransform, normalizeAngle, rotateXZ, yawFromQuat } from './math';
import { applyOps, type OpContext, type OpError } from './ops';
import { classOf, prepareShell, type RuleContext } from './rules';
import { findSupport, restingSurface, settleTarget, subtreeIds, type SupportHit } from './support';

/**
 * Editor-level commands that compose contract ops (shared by the web editor and the backend).
 * Each returns a flat op list that applies as ONE undo entry.
 */

const byId = (scene: Pick<SceneSpec, 'objects'>, id: string) => scene.objects.find((o) => o.id === id);

function samePlacement(a: Placement | undefined, b: Placement): boolean {
  return (a?.support ?? 'floor') === b.support && a?.parentId === b.parentId && !!a?.float === !!b.float;
}

/** Placement record for an object resting on `hit` (floor or a support owner). */
export function placementFor(ctx: Pick<RuleContext, 'assets'>, obj: SceneObject, hit: SupportHit | null): Placement {
  const cls = classOf(ctx, obj);
  const float = obj.placement?.float;
  if (cls === 'wall' || cls === 'ceiling') return { support: supportForClass(cls), ...(float ? { float } : {}) };
  const parentId = hit ? hit.ownerId : obj.placement?.parentId ?? null;
  return { support: supportForClass(cls, !!parentId), ...(parentId ? { parentId } : {}), ...(float ? { float } : {}) };
}

/**
 * Move an object to `transform`. With `settle` (default true), it then falls onto the highest
 * surface beneath it (or the floor) unless it is wall/ceiling-mounted or floating; with an explicit
 * `support`, it lands on that surface. Re-parenting is part of the same op list.
 */
export function moveWithSupport(
  ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, id: string, transform: Transform,
  opts: { settle?: boolean; support?: SupportHit | null } = {},
): SceneOp[] {
  const obj = byId(scene, id);
  if (!obj) return [];
  const moved: SceneObject = { ...obj, transform };
  const others = scene.objects;
  let hit: SupportHit | null = opts.support ?? null;
  if (!hit && opts.settle !== false) hit = settleTarget(others, moved, { assets: ctx.assets, floorY: ctx.shell.floor.elevationY });
  const final: Transform = hit ? { ...transform, position: [transform.position[0], hit.y, transform.position[2]] } : transform;
  const ops: SceneOp[] = [{ type: 'move', objectId: id, transform: final }];
  const placement = placementFor(ctx, obj, hit);
  if (!samePlacement(obj.placement, placement)) ops.push({ type: 'setPlacement', objectId: id, placement });
  return ops;
}

/**
 * Delete an object; whatever rests on it settles onto the next support below (or the floor).
 * Rejected if anything resting on it (at any depth) is locked.
 */
export function deleteWithSettle(ctx: OpContext, scene: SceneSpec, id: string): { ok: true; ops: SceneOp[] } | { ok: false; error: OpError } {
  const obj = byId(scene, id);
  if (!obj) return { ok: false, error: { code: 'NOT_FOUND', reason: 'NOT_FOUND', message: 'Object not found.', objectId: id } };
  if (obj.locked) return { ok: false, error: { code: 'VALIDATION_ERROR', reason: 'LOCKED', message: `${obj.displayName} is locked.`, objectId: id } };
  const sub = subtreeIds(scene.objects, id);
  const locked = scene.objects.find((o) => sub.has(o.id) && o.id !== id && o.locked);
  if (locked) return { ok: false, error: { code: 'VALIDATION_ERROR', reason: 'CHILD_LOCKED', message: `${locked.displayName} on it is locked.`, objectId: locked.id } };
  const ops: SceneOp[] = [];
  let cur = scene;
  const exclude = new Set([id]);
  for (const child of scene.objects.filter((o) => o.placement?.parentId === id)) {
    const c = byId(cur, child.id)!;
    const hit = findSupport(cur.objects, c, { assets: ctx.assets, floorY: ctx.shell.floor.elevationY }, { maxY: c.transform.position[1], exclude });
    const childOps = moveWithSupport(ctx, cur, c.id, c.transform, { support: hit });
    const r = applyOps({ ...ctx, geometry: 'report' }, cur, childOps);
    if (!r.ok) return { ok: false, error: r.error };
    cur = r.scene;
    ops.push(...childOps);
  }
  ops.push({ type: 'delete', objectId: id });
  return { ok: true, ops };
}

/** Objects in `ids` whose ancestors are not also in `ids` (the ones to move explicitly). */
export function rootsOf(scene: Pick<SceneSpec, 'objects'>, ids: readonly string[]): SceneObject[] {
  const set = new Set(ids);
  const index = new Map(scene.objects.map((o) => [o.id, o]));
  return ids.map((id) => index.get(id)).filter((o): o is SceneObject => {
    if (!o) return false;
    let p = o.placement?.parentId;
    for (let g = 0; p && g < 64; g++) {
      if (set.has(p)) return false;
      p = index.get(p)?.placement?.parentId;
    }
    return true;
  });
}

/** Transform of `obj` after translating by `delta` and rotating by `dYaw` about `pivot` (XZ). */
export function transformAbout(obj: SceneObject, delta: Vec2, dYaw: number, pivot: Vec2, dy = 0): Transform {
  const [x, y, z] = obj.transform.position;
  const r = rotateXZ([x - pivot[0], z - pivot[1]], dYaw);
  const yaw = normalizeAngle(yawFromQuat(obj.transform.rotation) + dYaw);
  const t = makeTransform([pivot[0] + r[0] + delta[0], y + dy, pivot[1] + r[1] + delta[1]], yaw);
  return dYaw === 0 ? { ...obj.transform, position: t.position } : t;
}

/** Move/rotate a selection as a group (descendants ride along with their roots); roots settle. */
export function groupTransformOps(
  ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, ids: readonly string[], delta: Vec2, dYaw: number, pivot: Vec2,
  opts: { settle?: boolean } = {},
): SceneOp[] {
  const roots = rootsOf(scene, ids);
  const moving = new Set(roots.flatMap((r) => [...subtreeIds(scene.objects, r.id)]));
  const statics = scene.objects.filter((o) => !moving.has(o.id) || roots.some((r) => r.id === o.id));
  const ops: SceneOp[] = [];
  for (const r of roots) {
    const t = transformAbout(r, delta, dYaw, pivot);
    const others = { objects: statics.filter((o) => o.id === r.id || !roots.some((x) => x.id === o.id)) };
    ops.push(...moveWithSupport(ctx, others, r.id, t, { settle: opts.settle }));
  }
  return ops;
}

/** Group pivot: centre of the selection's footprint bounds. */
export function selectionPivot(scene: Pick<SceneSpec, 'objects'>, ids: readonly string[]): Vec2 {
  const objs = ids.map((id) => byId(scene, id)).filter((o): o is SceneObject => !!o);
  if (!objs.length) return [0, 0];
  const xs = objs.map((o) => o.transform.position[0]);
  const zs = objs.map((o) => o.transform.position[2]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

/** Ops that keep direct children seated when the parent's surfaces change height (resize / tilt). */
function reseatChildren(ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, before: SceneObject, after: SceneObject): SceneOp[] {
  const ops: SceneOp[] = [];
  const newSurfaces = worldSurfaces(after, ctx.assets);
  for (const child of scene.objects.filter((o) => o.placement?.parentId === before.id)) {
    const s = restingSurface(before, child, ctx.assets);
    const ns = s ? newSurfaces.find((x) => x.id === s.id) : undefined;
    if (!s || !ns || Math.abs(ns.y - s.y) < 1e-9) continue;
    const [x, y, z] = child.transform.position;
    ops.push({ type: 'move', objectId: child.id, transform: { ...child.transform, position: [x, y + (ns.y - s.y), z] } });
  }
  return ops;
}

export function resizeOps(ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, id: string, dimensionsM: Vec3): SceneOp[] {
  const obj = byId(scene, id);
  if (!obj) return [];
  return [{ type: 'resize', objectId: id, dimensionsM }, ...reseatChildren(ctx, scene, obj, { ...obj, dimensionsM })];
}

export function tiltOps(ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>, id: string, tilt: Tilt): SceneOp[] {
  const obj = byId(scene, id);
  if (!obj) return [];
  return [{ type: 'setTilt', objectId: id, tilt }, ...reseatChildren(ctx, scene, obj, { ...obj, tilt })];
}

/** Aspect-locked resize: scale all axes by the ratio applied to one. */
export function lockedAspect(dims: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const k = value / dims[axis];
  return [dims[0] * k, dims[1] * k, dims[2] * k];
}

// ---------------------------------------------------------------- rotation continuity

/** Pointer bearing around a centre in yaw terms (0 = +Z, positive toward +X). */
export function bearing(center: Vec2, p: Vec2): number {
  return Math.atan2(p[0] - center[0], p[1] - center[1]);
}

/**
 * Continuous dial rotation: accumulates wrapped deltas of the pointer bearing so crossing ±180° (or
 * spinning several turns) never jumps. Stored yaw is normalised to (−π, π].
 */
export class YawDial {
  private last: number;
  private acc = 0;

  constructor(private readonly startYaw: number, startBearing: number) {
    this.last = startBearing;
  }

  update(pointerBearing: number): void {
    this.acc += normalizeAngle(pointerBearing - this.last);
    this.last = pointerBearing;
  }

  /** Accumulated rotation since the drag began (unbounded, radians). */
  get accumulated(): number {
    return this.acc;
  }

  yaw(snapRad?: number): number {
    const a = snapRad ? Math.round(this.acc / snapRad) * snapRad : this.acc;
    return normalizeAngle(this.startYaw + a);
  }

  /**
   * Rotation to apply so a piece starting at `fromYaw` follows the pointer; with `snapRad` the
   * resulting angle lands on the absolute grid (0°, 15°, 30°…), not on steps from where it began.
   */
  delta(fromYaw: number, snapRad?: number): number {
    if (!snapRad) return this.acc;
    return Math.round((fromYaw + this.acc) / snapRad) * snapRad - fromYaw;
  }
}

// ---------------------------------------------------------------- ceiling / wall poses

/** Pose for a ceiling item hung `dropM` below the ceiling at `point`, clamped to the allowed range. */
export function ceilingPose(shell: RoomShell, dimensionsM: Vec3, point: Vec2, dropM: number, minBottomM = 0.6): { position: Vec3; dropM: number } {
  const p = prepareShell(shell);
  const h = dimensionsM[1];
  const maxDrop = Math.max(0, p.ceilingY - h - (shell.floor.elevationY + minBottomM));
  const drop = Math.max(0, Math.min(maxDrop, dropM));
  return { position: [point[0], p.ceilingY - h - drop, point[1]], dropM: drop };
}

/** Effective height helper re-exported for UI readouts. */
export function heightOf(obj: SceneObject): number {
  return effectiveDimsOf(obj)[1];
}



/** The next angle on the absolute grid of `stepRad` in direction `dir` (±1) from `yaw`. */
export function stepYaw(yaw: number, dir: 1 | -1, stepRad: number): number {
  const k = yaw / stepRad;
  const onGrid = Math.abs(k - Math.round(k)) < 1e-6;
  const next = onGrid ? Math.round(k) + dir : dir > 0 ? Math.ceil(k) : Math.floor(k);
  return normalizeAngle(next * stepRad);
}
