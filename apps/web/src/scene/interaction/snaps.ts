import type { SceneObject, Vec2 } from '@house/contracts';
import { angleDiff, obbCorners, obbOf, pointSegmentDistance, prepareShell, yawFromQuat, type Body, type RuleContext } from '@house/scene-engine';
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

/**
 * Contact guides (merge decision 6.3): when a dragged piece is pressed against something (another
 * piece or a wall), a guide line marks the side of the piece that touches it. Nothing snaps; it only
 * shows where the contact is.
 */
export function contactGuides(moving: SceneObject, touching: readonly Body[]): Guide[] {
  const b = obbOf(moving);
  const y = moving.transform.position[1] + 0.004;
  const out: Guide[] = [];
  for (const t of touching) {
    const dir: Vec2 = [(t.min[0] + t.max[0]) / 2 - b.center[0], (t.min[2] + t.max[2]) / 2 - b.center[1]];
    const sides: { n: Vec2; half: number; along: Vec2; len: number }[] = [
      { n: b.u, half: b.halfW, along: b.v, len: b.halfD },
      { n: [-b.u[0], -b.u[1]], half: b.halfW, along: b.v, len: b.halfD },
      { n: b.v, half: b.halfD, along: b.u, len: b.halfW },
      { n: [-b.v[0], -b.v[1]], half: b.halfD, along: b.u, len: b.halfW },
    ];
    // A wall's box centre is far away along the wall; its facing side is still the best-aligned one.
    const s = sides.reduce((best, c) => (c.n[0] * dir[0] + c.n[1] * dir[1] > best.n[0] * dir[0] + best.n[1] * dir[1] ? c : best));
    const mid: Vec2 = [b.center[0] + s.n[0] * s.half, b.center[1] + s.n[1] * s.half];
    const ext = s.len + 0.08;
    out.push({ from: [mid[0] - s.along[0] * ext, y, mid[1] - s.along[1] * ext], to: [mid[0] + s.along[0] * ext, y, mid[1] + s.along[1] * ext] });
  }
  return out;
}
