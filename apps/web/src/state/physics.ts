import type { SceneSpec, Vec3 } from '@house/contracts';
import {
  bodyOf, boundsOfBodies, classOf, GridBroadPhase, subtreeIds, wallBodies,
  type Body, type RuleContext,
} from '@house/scene-engine';

/**
 * Collision environment for live drag feedback: one incremental broad-phase over every object's
 * cached body (re-binned only when an object changes), queried per drag tick.
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
