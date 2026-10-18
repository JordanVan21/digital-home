import type { SceneObject, SceneSpec, Vec3 } from '@house/contracts';
import {
  bodyOf, boundsOfBodies, classOf, GridBroadPhase, subtreeIds, translateBody, wallBodies,
  type Body, type RuleContext,
} from '@house/scene-engine';

/**
 * Collision environment for interactive edits: one incremental broad-phase over every object's
 * cached body (re-binned only when an object changes), queried per drag tick / command.
 */
const broad = new GridBroadPhase(1);
let lastScene: SceneSpec | null = null;

function syncBroad(ctx: RuleContext, scene: SceneSpec) {
  if (scene === lastScene) return;
  broad.sync(scene.objects.map((o) => bodyOf(o, ctx.assets)));
  lastScene = scene;
}

/** Ids moving together: the roots plus everything resting on them. */
export function movingSet(scene: SceneSpec, rootIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of rootIds) for (const x of subtreeIds(scene.objects, id)) out.add(x);
  return out;
}

/** Support chain under the moving roots (they rest on these, so they never collide with them). */
export function supportChain(scene: SceneSpec, rootIds: readonly string[]): Set<string> {
  const index = new Map(scene.objects.map((o) => [o.id, o]));
  const out = new Set<string>();
  for (const id of rootIds) {
    let p = index.get(id)?.placement?.parentId;
    for (let g = 0; p && g < 64; g++) {
      out.add(p);
      p = index.get(p)?.placement?.parentId;
    }
  }
  return out;
}

export function bodiesOf(ctx: RuleContext, scene: SceneSpec, ids: Iterable<string>): Body[] {
  const index = new Map(scene.objects.map((o) => [o.id, o]));
  return [...ids].map((id) => index.get(id)).filter((o): o is SceneObject => !!o).map((o) => bodyOf(o, ctx.assets));
}

/**
 * Obstacles for moving `rootIds`: nearby static bodies (broad-phase) minus the moving set and its
 * support chain (plus `exclude`), and the walls for floor-standing items.
 */
export function obstaclesFor(
  ctx: RuleContext, scene: SceneSpec, rootIds: readonly string[],
  opts: { exclude?: ReadonlySet<string>; bounds?: { min: Vec3; max: Vec3 }; pad?: number } = {},
): Body[] {
  syncBroad(ctx, scene);
  const skip = new Set([...movingSet(scene, rootIds), ...supportChain(scene, rootIds), ...(opts.exclude ?? [])]);
  const near = opts.bounds ? broad.query(opts.bounds.min, opts.bounds.max, opts.pad ?? 0.6) : scene.objects.map((o) => bodyOf(o, ctx.assets));
  const index = new Map(scene.objects.map((o) => [o.id, o]));
  const mounted = rootIds.length > 0 && rootIds.every((id) => {
    const o = index.get(id);
    const cls = o ? classOf(ctx, o) : 'floor';
    return cls === 'wall' || cls === 'ceiling';
  });
  return [...near.filter((b) => !skip.has(b.id)), ...(mounted ? [] : wallBodies(ctx.shell))];
}

/** Bounds of the moving bodies swept by an offset (for the broad-phase query). */
export function sweptBounds(moving: Body[], dx: number, dz: number): { min: Vec3; max: Vec3 } {
  const b = boundsOfBodies(moving);
  return {
    min: [Math.min(b.min[0], b.min[0] + dx), b.min[1], Math.min(b.min[2], b.min[2] + dz)],
    max: [Math.max(b.max[0], b.max[0] + dx), b.max[1], Math.max(b.max[2], b.max[2] + dz)],
  };
}

export function liftBodies(bodies: Body[], dy: number): Body[] {
  return dy === 0 ? bodies : bodies.map((b) => translateBody(b, 0, 0, dy));
}

/**
 * Per-drag obstacle query: exclusions computed once per session; each tick only hits the
 * broad-phase (no scene scans), keeping drag ticks well under a millisecond.
 */
export function obstacleQuery(ctx: RuleContext, scene: SceneSpec, rootIds: readonly string[]) {
  syncBroad(ctx, scene);
  const base = new Set([...movingSet(scene, rootIds), ...supportChain(scene, rootIds)]);
  const index = new Map(scene.objects.map((o) => [o.id, o]));
  const mounted = rootIds.length > 0 && rootIds.every((id) => {
    const o = index.get(id);
    const cls = o ? classOf(ctx, o) : 'floor';
    return cls === 'wall' || cls === 'ceiling';
  });
  const walls = mounted ? [] : wallBodies(ctx.shell);
  const chains = new Map<string, Set<string>>();
  const chainOf = (ownerId: string) => {
    let c = chains.get(ownerId);
    if (!c) {
      c = new Set<string>();
      let p: string | undefined = ownerId;
      for (let g = 0; p && g < 64; g++) { c.add(p); p = index.get(p)?.placement?.parentId; }
      chains.set(ownerId, c);
    }
    return c;
  };
  return (bounds: { min: Vec3; max: Vec3 }, supportOwnerId?: string | null): Body[] => {
    const extra = supportOwnerId ? chainOf(supportOwnerId) : null;
    const near = broad.query(bounds.min, bounds.max, 0.3).filter((b) => !base.has(b.id) && !extra?.has(b.id));
    return walls.length ? [...near, ...walls] : near;
  };
}
