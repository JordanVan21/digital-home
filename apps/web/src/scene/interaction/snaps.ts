import type { SceneObject, Vec2 } from '@house/contracts';
import { angleDiff, obbCorners, obbOf, pointSegmentDistance, prepareShell, yawFromQuat, type RuleContext } from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import type { Guide } from '../dragFeedback';

type Box = { minX: number; maxX: number; cX: number; minZ: number; maxZ: number; cZ: number };

function aabb(obj: SceneObject): Box {
  const c = obbCorners(obbOf(obj));
  const xs = c.map((p) => p[0]);
  const zs = c.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { minX, maxX, cX: (minX + maxX) / 2, minZ, maxZ, cZ: (minZ + maxZ) / 2 };
}

const quarterAligned = (yaw: number) => angleDiff(yaw, Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2)) < 2 * (Math.PI / 180);

/**
 * Smart snaps for a dragged object at `delta`: back-to-wall, plus edge and centre alignment with
 * nearby axis-aligned objects. Returns the adjusted delta and thin guide lines. Shift disables.
 */
export function smartSnap(ctx: RuleContext, moving: SceneObject, others: readonly SceneObject[], delta: Vec2): { delta: Vec2; guides: Guide[] } {
  const at = (d: Vec2): SceneObject => ({ ...moving, transform: { ...moving.transform, position: [moving.transform.position[0] + d[0], moving.transform.position[1], moving.transform.position[2] + d[1]] } });
  let d: Vec2 = [delta[0], delta[1]];
  const guides: Guide[] = [];
  const y = moving.transform.position[1] + 0.004;
  const yaw = yawFromQuat(moving.transform.rotation);

  // Back-to-wall: the back face (−Z side) slides flush onto a wall it's facing away from.
  const shell = prepareShell(ctx.shell);
  const b = obbOf(at(d));
  const back: Vec2 = [b.center[0] - b.v[0] * b.halfD, b.center[1] - b.v[1] * b.halfD];
  for (const w of shell.walls) {
    if (angleDiff(yaw, w.inwardYaw) > EDITOR_POLICY.wallSnapYawRad) continue;
    const dist = pointSegmentDistance(back, w.from, w.to);
    if (dist > EDITOR_POLICY.wallSnapM) continue;
    const signed = (back[0] - w.from[0]) * w.inward[0] + (back[1] - w.from[1]) * w.inward[1];
    d = [d[0] - w.inward[0] * signed, d[1] - w.inward[1] * signed];
    guides.push({ from: [w.from[0], y, w.from[1]], to: [w.to[0], y, w.to[1]] });
    break;
  }

  if (!quarterAligned(yaw)) return { delta: d, guides };
  const me = aabb(at(d));
  let bestX: { diff: number; x: number; other: Box } | null = null;
  let bestZ: { diff: number; z: number; other: Box } | null = null;
  for (const o of others) {
    if (!quarterAligned(yawFromQuat(o.transform.rotation))) continue;
    const ob = aabb(o);
    if (Math.max(me.minX, ob.minX) - Math.min(me.maxX, ob.maxX) > 1.5 && Math.max(me.minZ, ob.minZ) - Math.min(me.maxZ, ob.maxZ) > 1.5) continue;
    for (const [mine, theirs] of [[me.minX, ob.minX], [me.maxX, ob.maxX], [me.cX, ob.cX], [me.minX, ob.maxX], [me.maxX, ob.minX]] as const) {
      const diff = theirs - mine;
      if (Math.abs(diff) < EDITOR_POLICY.smartSnapM && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) bestX = { diff, x: theirs, other: ob };
    }
    for (const [mine, theirs] of [[me.minZ, ob.minZ], [me.maxZ, ob.maxZ], [me.cZ, ob.cZ], [me.minZ, ob.maxZ], [me.maxZ, ob.minZ]] as const) {
      const diff = theirs - mine;
      if (Math.abs(diff) < EDITOR_POLICY.smartSnapM && (!bestZ || Math.abs(diff) < Math.abs(bestZ.diff))) bestZ = { diff, z: theirs, other: ob };
    }
  }
  if (bestX) {
    d = [d[0] + bestX.diff, d[1]];
    const z0 = Math.min(me.minZ, bestX.other.minZ) - 0.1;
    const z1 = Math.max(me.maxZ, bestX.other.maxZ) + 0.1;
    guides.push({ from: [bestX.x, y, z0], to: [bestX.x, y, z1] });
  }
  if (bestZ) {
    d = [d[0], d[1] + bestZ.diff];
    const x0 = Math.min(me.minX, bestZ.other.minX) - 0.1;
    const x1 = Math.max(me.maxX, bestZ.other.maxX) + 0.1;
    guides.push({ from: [x0, y, bestZ.z], to: [x1, y, bestZ.z] });
  }
  return { delta: d, guides };
}
