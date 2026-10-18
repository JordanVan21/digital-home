import { Matrix4, Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { SceneObject, SceneOp, Vec2, Vec3 } from '@house/contracts';
import {
  bearing, bodyAt, candidateSurfaces, ceilingPose, classOf, EDGE_TOL_M, findSupport, groupTransformOps, isLarge,
  makeTransform, moveWithSupport, normalizeAngle, pointInPolygon, prepareShell, quatFromYaw, resolveRotation,
  resolveTranslation, restsOn, rootsOf, selectionPivot, subtreeIds, transformAbout, validateObject, wallPose, YawDial,
  indexObjects, yawFromQuat, type Blocker, type Body, type SupportHit, type WorldSurface,
} from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import { applyObjectTransform } from '../../lib/convert';
import { bodiesOf, liftBodies, movingSet, obstacleQuery, obstaclesFor, sweptBounds } from '../../state/physics';
import { commit, ignoringCollisions, objectById, opContext, releaseSettles, toast, useEditor } from '../../state/store';
import { dragFeedback } from '../dragFeedback';
import { interaction, registry } from '../registry';
import { contactGuides, smartSnap } from './snaps';

export type Host = { camera: Camera; dom: HTMLElement };
export type Mods = { alt: boolean; ctrl: boolean; shift: boolean };
export const modsOf = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): Mods => ({ alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });

const ray = new Raycaster();
const _v = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

export function setRay(host: Host, e: { clientX: number; clientY: number }): Raycaster {
  const r = host.dom.getBoundingClientRect();
  ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), host.camera);
  return ray;
}

/** Ray ∩ horizontal plane y = h (XZ), or null when parallel / behind the camera. */
export function hitPlaneY(r: Raycaster, h: number): Vector3 | null {
  const d = r.ray.direction;
  if (Math.abs(d.y) < 1e-6) return null;
  const t = (h - r.ray.origin.y) / d.y;
  return t > 0 ? r.ray.at(t, new Vector3()) : null;
}

function hitPlane(r: Raycaster, normal: Vector3, point: Vector3): Vector3 | null {
  return r.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point), new Vector3());
}

/** Place a group at a world position/yaw even though it may be nested under a parent's group. */
export function setWorldPose(group: Object3D, pos: Vec3, yaw: number) {
  const parent = group.parent;
  _v.set(pos[0], pos[1], pos[2]);
  _q.set(...quatFromYaw(yaw));
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert();
    _v.applyMatrix4(_m);
    const pq = new Quaternion();
    parent.getWorldQuaternion(pq);
    _q.premultiply(pq.invert());
  }
  group.position.copy(_v);
  group.quaternion.copy(_q);
  group.updateMatrixWorld();
}

function restore(ids: Iterable<string>) {
  for (const id of ids) {
    const g = registry.get(id);
    const o = objectById(id);
    if (!g || !o) continue;
    applyObjectTransform(g, o, objectById(o.placement?.parentId));
  }
}

function finish(label: string, ops: SceneOp[], roots: string[], extra?: () => void) {
  interaction.lastDragEndAt = performance.now();
  dragFeedback.clear();
  useEditor.setState({ dragging: false });
  if (!ops.length) return restore(roots);
  const r = commit(label, ops, { quiet: true });
  if (!r.ok) {
    restore(roots);
    toast(r.error.reason === 'GEOMETRY' ? `Snapped back — ${r.error.message}` : r.error.message, 'warning');
  } else extra?.();
}

const timed = <T>(f: () => T): T => {
  const t0 = performance.now();
  const out = f();
  const ms = performance.now() - t0;
  if (import.meta.env?.DEV && ms > EDITOR_POLICY.dragBudgetMs) console.warn(`[drag] collision/validation took ${ms.toFixed(1)} ms (> ${EDITOR_POLICY.dragBudgetMs} ms budget)`);
  return out;
};

export interface DragSession {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

// ---------------------------------------------------------------- move / lift / wall / ceiling

type Kind = 'move' | 'move3d' | 'wall' | 'ceiling' | 'ceilingLift';

/** Scroll-wheel height step per notch (m), and the cap for one wheel event (trackpads send many small ones). */
const WHEEL_M_PER_NOTCH = 0.05;
/** Codex's magnetic catch distance (m) and Shift grid (m). */
const FACE_SNAP_M = 0.12;
const GRID_M = 0.1;

/**
 * Direct manipulation of one or more objects (the primary interaction):
 * - move: horizontally across whatever they rest on; small items hop onto the support surface under
 *   the cursor (vase onto a table); dragged off an edge it holds its height and falls on release.
 * - Alt: move freely, no snapping (no hop, no magnetic catch, no wall snap). Shift: 10 cm grid.
 * - wall: slide along walls (crossing corners) and up/down. ceiling: across the ceiling; Alt = drop.
 * - move3d (3D move tool): the piece slides on a camera-facing "pane of glass" — sideways and up/down
 *   in one drag. From the top view (no screen "up") it falls back to a normal floor drag.
 * - The scroll wheel raises / lowers a single piece during any move or 3D move.
 */
export class MoveSession implements DragSession {
  private readonly ctx = opContext()!;
  private readonly scene = useEditor.getState().workingScene!;
  private readonly roots: SceneObject[];
  private readonly rootIds: string[];
  private readonly primary: SceneObject;
  private readonly kind: Kind;
  private readonly small: boolean;
  private readonly surfaces: WorldSurface[] = [];
  private readonly movingBodies;
  private readonly statics: SceneObject[];
  private readonly obstacles: ReturnType<typeof obstacleQuery>;
  private grab: Vec2 = [0, 0];
  private grabDy = 0;
  private prev: Vec2 = [0, 0];
  private prevDy = 0;
  private last: { offset: Vec2; dy: number; hit: SupportHit | null; yaw?: number; pos?: Vec3 } = { offset: [0, 0], dy: 0, hit: null };
  private pending: PointerEvent | null = null;
  private lastEvent: PointerEvent | null = null;
  private raf = 0;
  /** Height the piece is held at while dragging off a surface (falls on release). */
  private holdY = 0;
  private readonly owners = new Map(useEditor.getState().workingScene!.objects.map((o) => [o.id, o]));
  /** Height added with the scroll wheel during this drag (m). */
  private raise = 0;
  /** 3D move: offset from the pane-of-glass hit to the piece's base (x, y, z). */
  private grab3: Vec3 = [0, 0, 0];
  readonly ok: boolean;

  constructor(private readonly host: Host, down: PointerEvent, ids: string[], primaryId: string, private readonly mods: Mods) {
    const roots = rootsOf(this.scene, ids).filter((o) => !o.locked);
    const primaryRoot = roots.find((r) => subtreeIds(this.scene.objects, r.id).has(primaryId)) ?? roots[0];
    this.ok = !!primaryRoot && roots.length === rootsOf(this.scene, ids).length;
    this.primary = primaryRoot!;
    const cls = primaryRoot ? classOf(this.ctx, primaryRoot) : 'floor';
    const mounted = cls === 'wall' || cls === 'ceiling';
    this.roots = mounted ? [this.primary] : roots.filter((r) => { const c = classOf(this.ctx, r); return c !== 'wall' && c !== 'ceiling'; });
    this.rootIds = this.roots.map((r) => r.id);
    const look = new Vector3();
    host.camera.getWorldDirection(look);
    const topDown = look.y < -0.95;
    const tool = useEditor.getState().mode;
    this.kind = cls === 'wall' ? 'wall' : cls === 'ceiling' ? (mods.alt ? 'ceilingLift' : 'ceiling')
      : tool === 'move3d' && !topDown && roots.length === 1 ? 'move3d' : 'move';
    this.small = this.roots.length === 1 && !isLarge(this.primary?.category ?? '') && !mounted;
    const moving = movingSet(this.scene, this.rootIds);
    this.movingBodies = bodiesOf(this.ctx, this.scene, moving);
    this.statics = this.scene.objects.filter((o) => !moving.has(o.id));
    this.obstacles = obstacleQuery(this.ctx, this.scene, this.rootIds);
    if (!this.ok) return;
    if (this.small) this.surfaces = candidateSurfaces(this.scene.objects, this.primary, { assets: this.ctx.assets });
    this.holdY = this.primary.transform.position[1];

    const r = setRay(host, down);
    const [px, py, pz] = this.primary.transform.position;
    if (this.kind === 'move3d') {
      const h = this.liftPlaneHit(r) ?? new Vector3(px, py + 0.5, pz);
      this.grab3 = [px - h.x, py - h.y, pz - h.z];
    } else if (this.kind === 'ceilingLift' || this.kind === 'wall') {
      const h = this.liftPlaneHit(r) ?? new Vector3(px, py, pz);
      this.grabDy = h.y - py;
      this.grab = [px - h.x, pz - h.z];
    } else {
      const h = hitPlaneY(r, py);
      if (h) this.grab = [px - h.x, pz - h.z];
    }
    useEditor.setState({ dragging: true });
  }

  private liftPlaneHit(r: Raycaster): Vector3 | null {
    const [px, py, pz] = this.primary.transform.position;
    const n = new Vector3();
    this.host.camera.getWorldDirection(n);
    n.y = 0;
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    return hitPlane(r, n, new Vector3(px, py + 0.5, pz));
  }

  move(e: PointerEvent) {
    this.pending = e;
    this.lastEvent = e;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.pending) this.tick(this.pending); });
  }

  /** Scroll wheel during the drag: raise (scroll up) or lower (scroll down) a single piece. */
  wheel(deltaY: number) {
    if ((this.kind !== 'move' && this.kind !== 'move3d') || this.roots.length !== 1) return;
    const step = Math.max(-WHEEL_M_PER_NOTCH, Math.min(WHEEL_M_PER_NOTCH, (-deltaY / 100) * WHEEL_M_PER_NOTCH));
    const floorY = this.ctx.shell.floor.elevationY;
    this.raise = Math.max(floorY - this.primary.transform.position[1], this.raise + step);
    if (this.lastEvent) this.tick(this.lastEvent);
  }

  /** True when the piece is being held above where it would rest (wheel or 3D move). */
  private get raised() {
    return this.kind === 'move3d' || Math.abs(this.raise) > 1e-9;
  }

  private startOf(o: SceneObject): Vec3 {
    return o.transform.position;
  }

  private preview(offset: Vec2, dy: number, yawFor?: (o: SceneObject) => number) {
    for (const r of this.roots) {
      const g = registry.get(r.id);
      if (!g) continue;
      const [x, y, z] = this.startOf(r);
      const yaw = yawFor ? yawFor(r) : yawFromQuat(r.transform.rotation);
      setWorldPose(g, [x + offset[0], y + (r.id === this.primary.id ? dy : 0), z + offset[1]], yaw);
    }
  }

  private tick(e: PointerEvent) {
    const r = setRay(this.host, e);
    const shift = e.shiftKey;
    const ctrl = ignoringCollisions(e.ctrlKey || e.metaKey || this.mods.ctrl);
    const floorY = this.ctx.shell.floor.elevationY;
    const [px, py, pz] = this.primary.transform.position;

    if (this.kind === 'wall') {
      const h = this.wallHit(r);
      if (!h) return;
      const pose = wallPose(this.ctx.shell, this.primary.dimensionsM, [h.x, h.z], h.y - this.grabDy + this.primary.dimensionsM[1] / 2);
      if (!pose) return;
      this.last = { offset: [0, 0], dy: 0, hit: null, pos: pose.position, yaw: pose.yaw };
      const g = registry.get(this.primary.id);
      if (g) setWorldPose(g, pose.position, pose.yaw);
      this.feedbackFor({ ...this.primary, transform: makeTransform(pose.position, pose.yaw) }, [], ctrl);
      return;
    }
    if (this.kind === 'ceiling' || this.kind === 'ceilingLift') {
      const p = this.ctx.shell;
      const ceilY = prepareShell(p).ceilingY;
      let pos: Vec3;
      if (this.kind === 'ceiling') {
        const h = hitPlaneY(r, py);
        if (!h) return;
        pos = ceilingPose(p, this.primary.dimensionsM, [h.x + this.grab[0], h.z + this.grab[1]], ceilY - this.primary.dimensionsM[1] - py).position;
      } else {
        const h = this.liftPlaneHit(r);
        if (!h) return;
        pos = ceilingPose(p, this.primary.dimensionsM, [px, pz], ceilY - this.primary.dimensionsM[1] - (h.y - this.grabDy)).position;
      }
      this.last = { offset: [pos[0] - px, pos[2] - pz], dy: pos[1] - py, hit: null };
      this.preview(this.last.offset, this.last.dy);
      dragFeedback.set({ objectId: this.primary.id, height: this.kind === 'ceilingLift' ? this.readout(pos) : null });
      return;
    }

    // --- horizontal move (+ wheel height), or 3D move on the camera-facing pane of glass.
    // Stacking (codex) decides where a piece can rest; gravity (jordan) decides when it falls:
    // small items hop *up* onto surfaces under the cursor, but never drop while dragging — off an
    // edge they hold their height (with a drop line) and fall on release. Within 12 cm of a surface
    // the bottom face catches it magnetically. Alt = no snapping at all; Shift = 10 cm grid.
    const noSnap = e.altKey || this.mods.alt;
    let center: Vec2 | null = null;
    let targetY = py;
    let hit: SupportHit | null = null;
    if (this.kind === 'move3d') {
      const h = this.liftPlaneHit(r);
      if (!h) return;
      center = [h.x + this.grab3[0], h.z + this.grab3[2]];
      targetY = Math.max(floorY, h.y + this.grab3[1] + this.raise);
    } else if (this.raised) {
      targetY = Math.max(floorY, py + this.raise);
    } else if (this.small && !noSnap) {
      let bestT = Infinity;
      const o = r.ray.origin;
      const d = r.ray.direction;
      for (const s of this.surfaces) {
        if (d.y > -1e-6) break;
        if (s.y < this.holdY - 0.005) continue; // never hop down mid-drag
        const t = (s.y - o.y) / d.y;
        if (t <= 0 || t >= bestT) continue;
        const c: Vec2 = [o.x + d.x * t + this.grab[0], o.z + d.z * t + this.grab[1]];
        if (!pointInPolygon(c, s.polygon, EDGE_TOL_M)) continue;
        const probe: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [c[0], s.y, c[1]] } };
        if (!restsOn(probe, s, this.owners.get(s.ownerId), this.ctx.assets)) continue;
        bestT = t;
        center = c;
        targetY = s.y;
        hit = { ownerId: s.ownerId, surfaceId: s.id, y: s.y };
      }
      if (d.y < -1e-6 && this.holdY <= floorY + 0.005) {
        const tf = (floorY - o.y) / d.y;
        if (tf > 0 && tf < bestT) {
          center = [o.x + d.x * tf + this.grab[0], o.z + d.z * tf + this.grab[1]];
          targetY = floorY;
          hit = { ownerId: null, surfaceId: 'floor', y: floorY };
        }
      }
      if (!center) targetY = this.holdY; // off every surface: hold the height until release
    } else if (this.small) {
      targetY = this.holdY;
    }
    if (!center) {
      const h = hitPlaneY(r, targetY);
      if (!h) return;
      center = [h.x + this.grab[0], h.z + this.grab[1]];
    }
    if (shift) center = [Math.round(center[0] / GRID_M) * GRID_M, Math.round(center[1] / GRID_M) * GRID_M];

    // Magnetic catch (codex): a free piece within 12 cm of a surface under its bottom centre lands on it.
    let snappedTo: { label: string; polygon: Vec2[] | null; y: number } | null = null;
    if (!noSnap && !hit && (this.raised || this.small) && this.roots.length === 1) {
      let best: { s: WorldSurface | null; dy: number } | null = null;
      for (const s of this.surfaces) {
        const gap = Math.abs(s.y - targetY);
        if (gap > FACE_SNAP_M || (best && gap >= best.dy)) continue;
        if (!pointInPolygon(center, s.polygon, EDGE_TOL_M)) continue;
        const probe: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [center[0], s.y, center[1]] } };
        if (!restsOn(probe, s, this.owners.get(s.ownerId), this.ctx.assets)) continue;
        best = { s, dy: gap };
      }
      const floorGap = Math.abs(targetY - floorY);
      if (floorGap <= FACE_SNAP_M && (!best || floorGap < best.dy)) best = { s: null, dy: floorGap };
      if (best) {
        const s = best.s;
        targetY = s ? s.y : floorY;
        hit = s ? { ownerId: s.ownerId, surfaceId: s.id, y: s.y } : { ownerId: null, surfaceId: 'floor', y: floorY };
        if (best.dy > 1e-4) snappedTo = { label: s ? objectById(s.ownerId)?.displayName ?? 'surface' : 'Floor', polygon: s ? s.polygon : null, y: targetY };
      }
    }
    if (this.small && !this.raised) this.holdY = targetY;

    let desired: Vec2 = [center[0] - px, center[1] - pz];
    const dy = targetY - py;
    let guides: { from: Vec3; to: Vec3 }[] = [];
    if (!shift && !noSnap) {
      const near = this.statics.filter((s) => Math.abs(s.transform.position[0] - center![0]) < 3 && Math.abs(s.transform.position[2] - center![1]) < 3);
      const snapped = smartSnap(this.ctx, { ...this.primary, transform: { ...this.primary.transform, position: [px, targetY, pz] } }, near, desired);
      desired = snapped.delta;
      guides = snapped.guides;
    }
    if (snappedTo?.polygon) {
      const p = snappedTo.polygon;
      for (let i = 0; i < p.length; i++) {
        const a = p[i]!;
        const b = p[(i + 1) % p.length]!;
        guides.push({ from: [a[0], snappedTo.y + 0.006, a[1]], to: [b[0], snappedTo.y + 0.006, b[1]] });
      }
    }
    let offset = desired;
    let blockers: Blocker[] = [];
    let touching: Body[] = [];
    const lift = this.small || this.raised ? dy : 0;
    if (!ctrl && EDITOR_POLICY.collision === 'block-and-slide') {
      const lifted = liftBodies(this.movingBodies, lift);
      if (Math.abs(dy - this.prevDy) > 1e-6) this.prev = [0, 0];
      const a = sweptBounds(lifted, desired[0], desired[1]);
      const b = sweptBounds(lifted, this.prev[0], this.prev[1]);
      const bounds = {
        min: [Math.min(a.min[0], b.min[0]), a.min[1], Math.min(a.min[2], b.min[2])] as Vec3,
        max: [Math.max(a.max[0], b.max[0]), a.max[1], Math.max(a.max[2], b.max[2])] as Vec3,
      };
      const obs = this.obstacles(bounds, hit?.ownerId);
      const res = timed(() => resolveTranslation(lifted, obs, this.prev, desired));
      offset = res.offset;
      blockers = res.blockers;
      touching = obs.filter((o) => blockers.some((b) => b.otherId === o.id));
    }
    this.prev = offset;
    this.prevDy = dy;
    this.last = { offset, dy: lift, hit };
    this.preview(offset, this.last.dy);
    const cand: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [px + offset[0], py + this.last.dy, pz + offset[1]] } };
    if (touching.length && this.roots.length === 1) guides = [...guides, ...contactGuides(cand, touching)];
    // Height readout + drop line whenever the piece is held above what it would rest on.
    const inAir = !hit && (this.raised || (this.small && targetY > floorY + 0.005));
    this.feedbackFor(cand, blockers, ctrl, guides, inAir ? this.readout(cand.transform.position) : null, snappedTo ? `Snapped to ${snappedTo.label}` : null);
  }

  private feedbackFor(cand: SceneObject, blockers: Blocker[], ctrl: boolean, guides: { from: Vec3; to: Vec3 }[] = [], height: ReturnType<MoveSession['readout']> | null = null, note: string | null = null) {
    let violations = dragFeedback.violations;
    if (ctrl || this.kind === 'wall') {
      violations = timed(() => {
        const index = indexObjects(this.scene.objects);
        index.set(cand.id, cand);
        const near = obstaclesFor(this.ctx, this.scene, this.rootIds, { bounds: sweptBounds([bodyAt(cand, this.ctx.assets)], 0, 0) })
          .filter((b) => !b.wall).map((b) => index.get(b.id)!).filter(Boolean);
        return validateObject(this.ctx, index, cand, near).filter((v) => v.rule === 'overlap' || v.severity === 'error');
      });
    } else violations = [];
    dragFeedback.set({ objectId: this.primary.id, blockers, violations, guides, height, note: ctrl ? 'Collisions off' : note });
  }

  private readout(pos: Vec3) {
    const floorY = this.ctx.shell.floor.elevationY;
    const probe: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: pos } };
    const below = findSupport(this.statics, probe, { assets: this.ctx.assets, floorY }, { maxY: pos[1] });
    const owner = below.ownerId ? objectById(below.ownerId) : undefined;
    return {
      at: [pos[0], pos[1] + this.primary.dimensionsM[1] + 0.15, pos[2]] as Vec3,
      baseY: pos[1], floorY, surfaceY: below.y, surfaceLabel: owner ? owner.displayName : null,
      down: [pos[0], below.y, pos[2]] as Vec3,
    };
  }

  /** Ray against the room's walls from the inside; nearest interior-face hit within the wall span. */
  private wallHit(r: Raycaster): Vector3 | null {
    const shell = prepareShell(this.ctx.shell);
    let best: { t: number; p: Vector3 } | null = null;
    for (const w of shell.walls) {
      const n = new Vector3(w.inward[0], 0, w.inward[1]);
      if (r.ray.direction.dot(n) >= 0) continue; // must face the wall's interior side
      const p = hitPlane(r, n, new Vector3(w.from[0], 0, w.from[1]));
      if (!p) continue;
      const s = (p.x - w.from[0]) * w.dir[0] + (p.z - w.from[1]) * w.dir[1];
      if (s < -0.3 || s > w.length + 0.3 || p.y < -0.2 || p.y > w.wall.heightM + 0.2) continue;
      const t = p.distanceTo(r.ray.origin);
      if (!best || t < best.t) best = { t, p };
    }
    return best?.p ?? null;
  }

  up() {
    cancelAnimationFrame(this.raf);
    if (this.pending) this.tick(this.pending);
    const { offset, dy, hit } = this.last;
    const [px, py, pz] = this.primary.transform.position;
    let ops: SceneOp[] = [];
    if (this.kind === 'wall') {
      if (this.last.pos) ops = [{ type: 'move', objectId: this.primary.id, transform: makeTransform(this.last.pos, this.last.yaw ?? 0) }];
    } else if (this.kind === 'ceiling' || this.kind === 'ceilingLift') {
      ops = [{ type: 'move', objectId: this.primary.id, transform: { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] } }];
    } else if (this.raised || (this.small && this.roots.length === 1)) {
      const t = { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] as Vec3 };
      // Resting on a surface (hop or magnetic catch) → attach to it; otherwise gravity per the release mode.
      ops = moveWithSupport(this.ctx, this.scene, this.primary.id, t, hit ? { support: hit } : { settle: releaseSettles(this.raised) });
    } else {
      ops = groupTransformOps(this.ctx, this.scene, this.rootIds, offset, 0, [0, 0]);
    }
    const moved = Math.hypot(offset[0], offset[1]) > 1e-6 || Math.abs(dy) > 1e-6 || this.kind === 'wall';
    const ignored = (this.mods.ctrl || dragFeedback.note) && dragFeedback.violations.length > 0;
    finish(this.raised ? 'Lift' : 'Move', moved ? ops : [], this.rootIds, () => {
      if (ignored) toast('Placed with collisions ignored — it’s flagged.', 'warning');
    });
  }

  cancel() {
    cancelAnimationFrame(this.raf);
    restore(this.rootIds);
    interaction.lastDragEndAt = performance.now();
    dragFeedback.clear();
    useEditor.setState({ dragging: false });
  }
}

// ---------------------------------------------------------------- rotate (floor ring dial)

/**
 * Turn-the-dial rotation: the pointer's bearing around the pivot drives yaw continuously (no
 * clamping or jumps across ±180°, any number of turns). Shift snaps to 15°. Collisions push the
 * object clear when possible, otherwise the last valid angle is kept.
 */
export class RotateSession implements DragSession {
  private readonly ctx = opContext()!;
  private readonly scene = useEditor.getState().workingScene!;
  private readonly roots: SceneObject[];
  private readonly rootIds: string[];
  private readonly pivot: Vec2;
  private readonly planeY: number;
  private readonly dial: YawDial;
  private readonly all: SceneObject[];
  private last = { dYaw: 0, offset: [0, 0] as Vec2 };
  private pending: PointerEvent | null = null;
  private raf = 0;
  readonly ok: boolean;

  constructor(private readonly host: Host, down: PointerEvent, private readonly mods: Mods) {
    const ids = useEditor.getState().selectedIds;
    this.roots = rootsOf(this.scene, ids).filter((o) => !o.locked && classOf(this.ctx, o) !== 'wall');
    this.rootIds = this.roots.map((r) => r.id);
    this.ok = this.roots.length > 0;
    const p0 = this.roots[0]?.transform.position ?? [0, 0, 0];
    this.pivot = this.roots.length === 1 ? [p0[0], p0[2]] : selectionPivot(this.scene, this.rootIds);
    this.planeY = Math.min(...this.roots.map((r) => r.transform.position[1]));
    this.all = [...movingSet(this.scene, this.rootIds)].map((id) => objectById(id)!).filter(Boolean);
    const h = hitPlaneY(setRay(host, down), this.planeY) ?? new Vector3(this.pivot[0] + 1, 0, this.pivot[1]);
    this.dial = new YawDial(0, bearing(this.pivot, [h.x, h.z]));
    if (this.ok) useEditor.setState({ dragging: true });
  }

  move(e: PointerEvent) {
    this.pending = e;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.pending) this.tick(this.pending); });
  }

  private tick(e: PointerEvent) {
    const h = hitPlaneY(setRay(this.host, e), this.planeY);
    if (!h) return;
    this.dial.update(bearing(this.pivot, [h.x, h.z]));
    const dYaw = this.dial.yaw(e.shiftKey ? EDITOR_POLICY.snap.rotateRad : undefined);
    const ctrl = ignoringCollisions(e.ctrlKey || e.metaKey || this.mods.ctrl);
    let offset: Vec2 = [0, 0];
    let blockers: Blocker[] = [];
    if (!ctrl && EDITOR_POLICY.collision === 'block-and-slide') {
      const rotated = this.all.map((o) => bodyAt({ ...o, transform: transformAbout(o, [0, 0], dYaw, this.pivot) }, this.ctx.assets));
      const res = timed(() => resolveRotation(rotated, obstaclesFor(this.ctx, this.scene, this.rootIds, { bounds: sweptBounds(rotated, 0, 0) })));
      if (!res) {
        dragFeedback.set({ objectId: this.roots[0]!.id, note: `Blocked at ${Math.round((this.last.dYaw * 180) / Math.PI)}°` });
        return;
      }
      offset = res.offset;
      blockers = res.blockers;
    }
    this.last = { dYaw, offset };
    for (const r of this.roots) {
      const g = registry.get(r.id);
      if (!g) continue;
      const t = transformAbout(r, offset, dYaw, this.pivot);
      setWorldPose(g, t.position, yawFromQuat(t.rotation));
    }
    const yaw0 = yawFromQuat(this.roots[0]!.transform.rotation);
    const shown = Math.round((normalizeAngle(yaw0 + dYaw) * 180) / Math.PI);
    dragFeedback.set({ objectId: this.roots[0]!.id, blockers, note: `${shown}°${e.shiftKey ? ' (15° steps)' : ''}${ctrl ? ' · collisions off' : ''}` });
  }

  up() {
    cancelAnimationFrame(this.raf);
    if (this.pending) this.tick(this.pending);
    const { dYaw, offset } = this.last;
    const ops = Math.abs(dYaw) > 1e-9 || Math.hypot(offset[0], offset[1]) > 1e-9
      ? groupTransformOps(this.ctx, this.scene, this.rootIds, offset, dYaw, this.pivot, { settle: false })
      : [];
    finish('Rotate', ops, this.rootIds);
  }

  cancel() {
    cancelAnimationFrame(this.raf);
    restore(this.rootIds);
    dragFeedback.clear();
    useEditor.setState({ dragging: false });
  }
}

export { restore as restoreGroups };
