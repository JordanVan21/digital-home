import { Matrix4, Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { SceneObject, SceneOp, Vec2, Vec3 } from '@house/contracts';
import {
  bearing, bodyAt, candidateSurfaces, ceilingPose, classOf, CONFLICT_RULES, findSupport, fitsSurface, groupTransformOps,
  indexObjects, isLarge, makeTransform, normalizeAngle, pointInPolygon, prepareShell, quatFromYaw, rootsOf,
  selectionPivot, snapToSurface, subtreeIds, transformAbout, validateObject, wallPose, YawDial, yawFromQuat,
  type ContactSurface, type Violation, type WorldSurface,
} from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import { movingSet, obstaclesFor, sweptBounds } from '../../state/physics';
import { commit, contactMove, objectById, opContext, useEditor } from '../../state/store';
import { dragFeedback } from '../dragFeedback';
import { driven, interaction, registry } from '../registry';
import { smartSnap } from './snaps';

export type Host = { camera: Camera; dom: HTMLElement };
/** alt: move freely (no snapping) · shift: 10 cm grid / 15° steps · height: up/down (Space or the height tool). */
export type Mods = { alt: boolean; shift: boolean; height: boolean };
export const modsOf = (e: { altKey: boolean; shiftKey: boolean }): Mods => {
  const s = useEditor.getState();
  return { alt: e.altKey, shift: e.shiftKey, height: s.movePlane === 'height' || s.heightModifier };
};

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

/** Hand the groups back to the scene: they glide to their stored (or suggested) transforms. */
function restore(ids: Iterable<string>) {
  for (const id of ids) driven.delete(id);
}

/** Release: the gesture becomes one suggestion (conflicts allowed; Accept resolves them). */
function finish(label: string, ops: SceneOp[], roots: string[]) {
  interaction.lastDragEndAt = performance.now();
  dragFeedback.clear();
  if (ops.length) commit(label, ops);
  restore(roots);
  useEditor.setState({ dragging: false });
}

const conflictKey = (id: string, v: Violation) => `${id}:${v.rule}:${v.otherId ?? ''}`;

/** Conflicts objects already have in the accepted room (they never show as new conflicts). */
function priorConflicts(ctx: ReturnType<typeof opContext>, ids: Iterable<string>): Set<string> {
  const accepted = useEditor.getState().acceptedScene;
  const out = new Set<string>();
  if (!ctx || !accepted) return out;
  const index = indexObjects(accepted.objects);
  for (const id of ids) {
    const o = index.get(id);
    if (!o) continue;
    for (const v of validateObject(ctx, index, o)) if (CONFLICT_RULES.has(v.rule)) out.add(conflictKey(id, v));
  }
  return out;
}

const timed = <T>(f: () => T): T => {
  const t0 = performance.now();
  const out = f();
  const ms = performance.now() - t0;
  if (import.meta.env?.DEV && ms > EDITOR_POLICY.dragBudgetMs) console.warn(`[drag] validation took ${ms.toFixed(1)} ms (> ${EDITOR_POLICY.dragBudgetMs} ms budget)`);
  return out;
};

export interface DragSession {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

// ---------------------------------------------------------------- move / height / wall / ceiling

type Kind = 'move' | 'lift' | 'wall' | 'ceiling' | 'ceilingLift';

/**
 * Direct manipulation of one or more objects (the primary interaction). Suggesting is rule-free:
 * no gravity, no collision blocking — the pieces stay exactly where the user puts them, new
 * conflicts show red live, and release records one suggestion. Accept turns the rules back on.
 * Placement aids (Alt turns them all off):
 * - contact snap (codex): the base clicks onto an exposed top face (table top, seat, shelf, floor)
 *   within 12 cm, with a guide outlining it;
 * - small items hop onto the surface under the cursor (vase onto a table, off the edge to the floor);
 * - alignment and back-to-wall snaps; Shift snaps the centre to a 10 cm grid instead.
 * Kinds: move (across the floor plane), lift (Space / height tool: up and down, stays where released),
 * wall (slide along walls), ceiling (across the ceiling).
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
  private readonly statics: SceneObject[];
  private readonly prior: Set<string>;
  private grab: Vec2 = [0, 0];
  private grabDy = 0;
  private last: { offset: Vec2; dy: number; yaw?: number; pos?: Vec3 } = { offset: [0, 0], dy: 0 };
  readonly ok: boolean;

  constructor(private readonly host: Host, down: PointerEvent, ids: string[], primaryId: string, mods: Mods) {
    const roots = rootsOf(this.scene, ids).filter((o) => !o.locked);
    const primaryRoot = roots.find((r) => subtreeIds(this.scene.objects, r.id).has(primaryId)) ?? roots[0];
    this.ok = !!primaryRoot && roots.length === rootsOf(this.scene, ids).length;
    this.primary = primaryRoot!;
    const cls = primaryRoot ? classOf(this.ctx, primaryRoot) : 'floor';
    const mounted = cls === 'wall' || cls === 'ceiling';
    this.roots = mounted ? [this.primary] : roots.filter((r) => { const c = classOf(this.ctx, r); return c !== 'wall' && c !== 'ceiling'; });
    this.rootIds = this.roots.map((r) => r.id);
    this.kind = cls === 'wall' ? 'wall' : cls === 'ceiling' ? (mods.height ? 'ceilingLift' : 'ceiling') : mods.height ? 'lift' : 'move';
    this.small = this.roots.length === 1 && !isLarge(this.primary?.category ?? '') && !mounted;
    const moving = movingSet(this.scene, this.rootIds);
    this.statics = this.scene.objects.filter((o) => !moving.has(o.id));
    this.prior = priorConflicts(this.ctx, moving);
    if (!this.ok) return;
    if (this.small) this.surfaces = candidateSurfaces(this.scene.objects, this.primary, { assets: this.ctx.assets });

    const r = setRay(host, down);
    const [px, py, pz] = this.primary.transform.position;
    if (this.kind === 'lift' || this.kind === 'ceilingLift' || this.kind === 'wall') {
      const h = this.liftPlaneHit(r) ?? new Vector3(px, py, pz);
      this.grabDy = h.y - py;
      this.grab = [px - h.x, pz - h.z];
    } else {
      const h = hitPlaneY(r, py);
      if (h) this.grab = [px - h.x, pz - h.z];
    }
    this.rootIds.forEach((id) => driven.add(id));
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

  /** Every pointer event updates at once (no frame batching): the piece stays under the pointer. */
  move(e: PointerEvent) {
    this.tick(e);
  }

  private preview(offset: Vec2, dy: number) {
    for (const r of this.roots) {
      const g = registry.get(r.id);
      if (!g) continue;
      const [x, y, z] = r.transform.position;
      setWorldPose(g, [x + offset[0], y + (r.id === this.primary.id ? dy : 0), z + offset[1]], yawFromQuat(r.transform.rotation));
    }
  }

  private tick(e: PointerEvent) {
    const r = setRay(this.host, e);
    const shift = e.shiftKey;
    const free = e.altKey;
    const grid = EDITOR_POLICY.gridSnapM;
    const floorY = this.ctx.shell.floor.elevationY;
    const [px, py, pz] = this.primary.transform.position;

    if (this.kind === 'wall') {
      const h = this.wallHit(r);
      if (!h) return;
      const pose = wallPose(this.ctx.shell, this.primary.dimensionsM, [h.x, h.z], h.y - this.grabDy + this.primary.dimensionsM[1] / 2);
      if (!pose) return;
      this.last = { offset: [0, 0], dy: 0, pos: pose.position, yaw: pose.yaw };
      const g = registry.get(this.primary.id);
      if (g) setWorldPose(g, pose.position, pose.yaw);
      this.feedbackFor({ ...this.primary, transform: makeTransform(pose.position, pose.yaw) });
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
      this.last = { offset: [pos[0] - px, pos[2] - pz], dy: pos[1] - py };
      this.preview(this.last.offset, this.last.dy);
      dragFeedback.set({ objectId: this.primary.id, height: this.kind === 'ceilingLift' ? this.readout(pos) : null });
      return;
    }
    if (this.kind === 'lift') {
      const h = this.liftPlaneHit(r);
      if (!h) return;
      let baseY = Math.max(floorY, h.y - this.grabDy);
      if (shift) baseY = floorY + Math.round((baseY - floorY) / grid) * grid;
      let surface: ContactSurface | undefined;
      if (!free) {
        const snap = snapToSurface(this.ctx, this.statics, this.primary, { ...this.primary.transform, position: [px, baseY, pz] });
        baseY = snap.transform.position[1];
        surface = snap.surface;
      }
      this.last = { offset: [0, 0], dy: baseY - py };
      this.preview([0, 0], baseY - py);
      const cand: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [px, baseY, pz] } };
      this.feedbackFor(cand, [], surface);
      dragFeedback.set({ height: this.readout([px, baseY, pz]) });
      return;
    }

    // --- horizontal move
    let center: Vec2 | null = null;
    let targetY = py;
    let hopped = false;
    if (this.small && !free) {
      let bestT = Infinity;
      const o = r.ray.origin;
      const d = r.ray.direction;
      for (const s of this.surfaces) {
        if (d.y > -1e-6) break;
        const t = (s.y - o.y) / d.y;
        if (t <= 0 || t >= bestT) continue;
        const c: Vec2 = [o.x + d.x * t + this.grab[0], o.z + d.z * t + this.grab[1]];
        if (!pointInPolygon(c, s.polygon, 0)) continue;
        const probe: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [c[0], s.y, c[1]] } };
        if (!fitsSurface(probe, s)) continue;
        bestT = t;
        center = c;
        targetY = s.y;
        hopped = true;
      }
      if (d.y < -1e-6) {
        const tf = (floorY - o.y) / d.y;
        if (tf > 0 && tf < bestT) {
          center = [o.x + d.x * tf + this.grab[0], o.z + d.z * tf + this.grab[1]];
          targetY = floorY;
          hopped = true;
        }
      }
    }
    if (!center) {
      const h = hitPlaneY(r, py);
      if (!h) return;
      center = [h.x + this.grab[0], h.z + this.grab[1]];
    }
    let offset: Vec2 = [center[0] - px, center[1] - pz];
    let guides: { from: Vec3; to: Vec3 }[] = [];
    if (shift) {
      offset = [Math.round((px + offset[0]) / grid) * grid - px, Math.round((pz + offset[1]) / grid) * grid - pz];
    } else if (!free) {
      const near = this.statics.filter((s) => Math.abs(s.transform.position[0] - center![0]) < 3 && Math.abs(s.transform.position[2] - center![1]) < 3);
      const snapped = smartSnap(this.ctx, { ...this.primary, transform: { ...this.primary.transform, position: [px, targetY, pz] } }, near, offset);
      offset = snapped.delta;
      guides = snapped.guides;
    }
    // Contact snap for the primary piece (single non-hopping drags): its base clicks onto a face nearby.
    let dy = this.small ? targetY - py : 0;
    let surface: ContactSurface | undefined;
    if (!free && this.roots.length === 1) {
      const snap = snapToSurface(this.ctx, this.statics, this.primary, { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] });
      if (snap.surface && (!hopped || snap.surface.y === py + dy)) {
        dy = snap.transform.position[1] - py;
        surface = snap.surface;
      }
    }
    this.last = { offset, dy };
    this.preview(offset, dy);
    const cand: SceneObject = { ...this.primary, transform: { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] } };
    this.feedbackFor(cand, guides, surface);
  }

  /** Live red feedback: conflicts the dragged piece would newly introduce (never blocks). */
  private feedbackFor(cand: SceneObject, guides: { from: Vec3; to: Vec3 }[] = [], surface?: ContactSurface) {
    const violations = timed(() => {
      const index = indexObjects(this.scene.objects);
      index.set(cand.id, cand);
      const near = obstaclesFor(this.ctx, this.scene, this.rootIds, { bounds: sweptBounds([bodyAt(cand, this.ctx.assets)], 0, 0) })
        .filter((b) => !b.wall).map((b) => index.get(b.id)!).filter(Boolean);
      return validateObject(this.ctx, index, cand, near).filter((v) => CONFLICT_RULES.has(v.rule) && !this.prior.has(conflictKey(cand.id, v)));
    });
    // The floor itself needs no guide.
    const shown = surface?.ownerId ? { y: surface.y, polygon: surface.polygon } : null;
    dragFeedback.set({ objectId: this.primary.id, blockers: [], violations, guides, height: null, note: null, surface: shown });
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

  /** Release: exactly where it is; the resting-on link follows exact contact (or none). */
  up() {
    const { offset, dy } = this.last;
    const [px, py, pz] = this.primary.transform.position;
    let ops: SceneOp[] = [];
    if (this.kind === 'wall') {
      if (this.last.pos) ops = [{ type: 'move', objectId: this.primary.id, transform: makeTransform(this.last.pos, this.last.yaw ?? 0) }];
    } else if (this.kind === 'ceiling' || this.kind === 'ceilingLift') {
      ops = [{ type: 'move', objectId: this.primary.id, transform: { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] } }];
    } else if (this.roots.length === 1) {
      const t = { ...this.primary.transform, position: [px + offset[0], py + dy, pz + offset[1]] as Vec3 };
      ops = contactMove(this.ctx, this.statics, this.primary, t);
    } else {
      ops = groupTransformOps(this.ctx, this.scene, this.rootIds, offset, 0, [0, 0], { settle: false });
    }
    const moved = Math.hypot(offset[0], offset[1]) > 1e-6 || Math.abs(dy) > 1e-6 || this.kind === 'wall';
    finish(this.kind === 'lift' ? 'Lift' : 'Move', moved ? ops : [], this.rootIds);
  }

  cancel() {
    restore(this.rootIds);
    interaction.lastDragEndAt = performance.now();
    dragFeedback.clear();
    useEditor.setState({ dragging: false });
  }
}

// ---------------------------------------------------------------- rotate (swivel ring)

/**
 * Free swivel: the pointer's bearing around the pivot drives yaw continuously (no clamping or
 * jumps across ±180°, any number of turns). Shift snaps to 15°. Never blocked: new conflicts show
 * red live and resolve on Accept.
 */
export class RotateSession implements DragSession {
  private readonly ctx = opContext()!;
  private readonly scene = useEditor.getState().workingScene!;
  private readonly roots: SceneObject[];
  private readonly rootIds: string[];
  private readonly pivot: Vec2;
  private readonly planeY: number;
  private readonly dial: YawDial;
  private readonly prior: Set<string>;
  private last = { dYaw: 0 };
  readonly ok: boolean;

  constructor(private readonly host: Host, down: PointerEvent) {
    const ids = useEditor.getState().selectedIds;
    this.roots = rootsOf(this.scene, ids).filter((o) => !o.locked && classOf(this.ctx, o) !== 'wall');
    this.rootIds = this.roots.map((r) => r.id);
    this.ok = this.roots.length > 0;
    const p0 = this.roots[0]?.transform.position ?? [0, 0, 0];
    this.pivot = this.roots.length === 1 ? [p0[0], p0[2]] : selectionPivot(this.scene, this.rootIds);
    this.planeY = Math.min(...this.roots.map((r) => r.transform.position[1]));
    const h = hitPlaneY(setRay(host, down), this.planeY) ?? new Vector3(this.pivot[0] + 1, 0, this.pivot[1]);
    this.dial = new YawDial(0, bearing(this.pivot, [h.x, h.z]));
    this.prior = priorConflicts(this.ctx, movingSet(this.scene, this.rootIds));
    if (!this.ok) return;
    this.rootIds.forEach((id) => driven.add(id));
    useEditor.setState({ dragging: true });
  }

  move(e: PointerEvent) {
    this.tick(e);
  }

  private tick(e: PointerEvent) {
    const h = hitPlaneY(setRay(this.host, e), this.planeY);
    if (!h) return;
    this.dial.update(bearing(this.pivot, [h.x, h.z]));
    const dYaw = this.dial.yaw(e.shiftKey ? EDITOR_POLICY.snap.rotateRad : undefined);
    this.last = { dYaw };
    const rotated: SceneObject[] = [];
    for (const r of this.roots) {
      const t = transformAbout(r, [0, 0], dYaw, this.pivot);
      rotated.push({ ...r, transform: t });
      const g = registry.get(r.id);
      if (g) setWorldPose(g, t.position, yawFromQuat(t.rotation));
    }
    const violations: Violation[] = timed(() => {
      const index = indexObjects(this.scene.objects);
      rotated.forEach((o) => index.set(o.id, o));
      const near = obstaclesFor(this.ctx, this.scene, this.rootIds, { bounds: sweptBounds(rotated.map((o) => bodyAt(o, this.ctx.assets)), 0, 0) })
        .filter((b) => !b.wall).map((b) => index.get(b.id)!).filter(Boolean);
      return rotated.flatMap((o) => validateObject(this.ctx, index, o, near)
        .filter((v) => CONFLICT_RULES.has(v.rule) && !this.prior.has(conflictKey(o.id, v))));
    });
    const yaw0 = yawFromQuat(this.roots[0]!.transform.rotation);
    const shown = Math.round((((normalizeAngle(yaw0 + dYaw) * 180) / Math.PI) % 360 + 360) % 360);
    dragFeedback.set({ objectId: this.roots[0]!.id, blockers: [], violations, angle: `${shown}°` });
  }

  up() {
    const { dYaw } = this.last;
    const ops = Math.abs(dYaw) > 1e-9 ? groupTransformOps(this.ctx, this.scene, this.rootIds, [0, 0], dYaw, this.pivot, { settle: false }) : [];
    finish('Rotate', ops, this.rootIds);
  }

  cancel() {
    restore(this.rootIds);
    interaction.lastDragEndAt = performance.now();
    dragFeedback.clear();
    useEditor.setState({ dragging: false });
  }
}
