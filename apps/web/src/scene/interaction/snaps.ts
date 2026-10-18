import type { SceneObject, Vec2 } from '@house/contracts';
import { angleDiff, obbOf, pointSegmentDistance, prepareShell, yawFromQuat, type Body, type RuleContext } from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import type { Guide } from '../dragFeedback';

/**
 * Wall snap (merge decision 6.3): while dragging, a piece whose back faces a wall within reach slides
 * flush onto it, with a guide line along the wall. That is the only alignment snap — pieces are
 * otherwise placed freely (no lining up with neighbours). Shift (10 cm grid) and Alt (no snapping)
 * turn it off.
 */
export function wallSnap(ctx: RuleContext, moving: SceneObject, delta: Vec2): { delta: Vec2; guides: Guide[] } {
  let d: Vec2 = [delta[0], delta[1]];
  const guides: Guide[] = [];
  const y = moving.transform.position[1] + 0.004;
  const yaw = yawFromQuat(moving.transform.rotation);
  const shell = prepareShell(ctx.shell);
  const b = obbOf({ ...moving, transform: { ...moving.transform, position: [moving.transform.position[0] + d[0], moving.transform.position[1], moving.transform.position[2] + d[1]] } });
  const back: Vec2 = [b.center[0] - b.v[0] * b.halfD, b.center[1] - b.v[1] * b.halfD];
  for (const w of shell.walls) {
    if (angleDiff(yaw, w.inwardYaw) > EDITOR_POLICY.wallSnapYawRad) continue;
    if (pointSegmentDistance(back, w.from, w.to) > EDITOR_POLICY.wallSnapM) continue;
    const signed = (back[0] - w.from[0]) * w.inward[0] + (back[1] - w.from[1]) * w.inward[1];
    d = [d[0] - w.inward[0] * signed, d[1] - w.inward[1] * signed];
    guides.push({ from: [w.from[0], y, w.from[1]], to: [w.to[0], y, w.to[1]] });
    break;
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
