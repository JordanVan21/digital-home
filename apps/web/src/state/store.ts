import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  AssetSpec, RenovationDecision, RoomShell, SceneAppearance, SceneObject, SceneOp, SceneSpec, Tilt, Vec2, Vec3,
} from '@house/contracts';
import {
  applyOps, bodyAt, ceilingPose, classOf, deleteWithSettle, duplicateObject, emptyHistory, findFreeSpot, findSupport,
  findWallSpot, groupTransformOps, makeTransform, moveWithSupport, normalizeAngle, objectFromAsset, pushHistory,
  redo as redoHistory, resizeOps, resolveRotation, resolveTranslation, rootsOf, selectionPivot, setAsset, setOwnership,
  tiltOps, transformAbout, undo as undoHistory, validateScene, yawFromQuat,
  type History, type OpContext, type OpError, type Violation,
} from '@house/scene-engine';
import type { AssetCatalog } from '../catalog/AssetCatalog';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { bodiesOf, movingSet, obstaclesFor, sweptBounds } from './physics';

export type SceneSource = 'demo-room' | 'demo-scan' | 'test2';
/** 'move3d' = 3D move: drags slide on a camera-facing plane (sideways + up/down). */
export type TransformMode = 'select' | 'translate' | 'move3d' | 'rotate';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
export type CameraPreset = 'top' | 'iso' | 'eye' | 'reset' | 'match';
export type CameraRequest =
  | { type: 'preset'; preset: CameraPreset; nonce: number }
  | { type: 'frame'; target: 'selection' | 'room'; nonce: number }
  | { type: 'focus'; point: Vec3; nonce: number };
export type WallMode = 'cutaway' | 'fade' | 'full';
export type Toast = { id: number; kind: 'info' | 'warning' | 'error'; text: string };

export type SaveState = {
  /** Local edits not yet acknowledged by the backend. */
  dirty: boolean;
  status: SaveStatus;
  lastError: string | null;
  /** Revision the pending ops apply on top of (CAS). */
  baseRevision: number;
  /** Ops committed locally since the last acknowledged save, in order. */
  pending: SceneOp[];
};

export type EditorState = {
  // ---- workingScene (the mutable editable scene; NOT an accepted version)
  source: SceneSource;
  roomName: string;
  shell: RoomShell | null;
  workingScene: SceneSpec | null;
  loadError: string | null;
  // ---- catalog
  catalog: AssetCatalog | null;
  assets: readonly AssetSpec[];
  // ---- selection / interaction (ephemeral)
  /** All selected ids; the last one is the primary (inspector) selection. */
  selectedIds: string[];
  selectedId: string | null;
  hoveredId: string | null;
  mode: TransformMode;
  dragging: boolean;
  snapping: boolean;
  /** Collisions off (toolbar / C): nothing blocks, but violations are still computed and shown. */
  collisionsOff: boolean;
  walkMode: boolean;
  wallMode: WallMode;
  // ---- history (editor-local; never a timeline)
  history: History;
  // ---- save
  save: SaveState;
  // ---- violations (committed scene), by object id
  violations: Record<string, Violation[]>;
  // ---- ui
  toasts: Toast[];
  libraryOpen: boolean;
  inspectorOpen: boolean;
  hideUi: boolean;
  cameraRequest: CameraRequest | null;
  reference: { open: boolean; mode: 'pip' | 'full'; opacity: number };
};

const initial: EditorState = {
  source: 'demo-room',
  roomName: '',
  shell: null,
  workingScene: null,
  loadError: null,
  catalog: null,
  assets: [],
  selectedIds: [],
  selectedId: null,
  hoveredId: null,
  mode: 'translate',
  dragging: false,
  snapping: false,
  collisionsOff: false,
  walkMode: false,
  wallMode: 'cutaway',
  history: emptyHistory(EDITOR_POLICY.historyCap),
  save: { dirty: false, status: 'idle', lastError: null, baseRevision: 0, pending: [] },
  violations: {},
  toasts: [],
  libraryOpen: false,
  inspectorOpen: true,
  hideUi: false,
  cameraRequest: null,
  reference: { open: false, mode: 'pip', opacity: 0.5 },
};

export const useEditor = create<EditorState>()(subscribeWithSelector(() => initial));

// ---------------------------------------------------------------- selectors / helpers
const get = useEditor.getState;
const set = useEditor.setState;

export function opContext(state = get()): OpContext | null {
  if (!state.shell) return null;
  const catalog = state.catalog;
  return { shell: state.shell, ...(catalog ? { assets: (id: string) => catalog.get(id) } : {}) };
}

export function objectById(id: string | null | undefined, state = get()): SceneObject | undefined {
  return id ? state.workingScene?.objects.find((o) => o.id === id) : undefined;
}

export function selectedObjects(state = get()): SceneObject[] {
  const ids = new Set(state.selectedIds);
  return state.workingScene?.objects.filter((o) => ids.has(o.id)) ?? [];
}

function violationIndex(scene: SceneSpec, ctx: OpContext): Record<string, Violation[]> {
  const out: Record<string, Violation[]> = {};
  for (const v of validateScene(ctx, scene).violations) {
    (out[v.objectId] ??= []).push(v);
    if (v.otherId && v.rule === 'overlap') (out[v.otherId] ??= []).push({ ...v, objectId: v.otherId, otherId: v.objectId });
  }
  return out;
}

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function describeOpError(e: OpError | { reason: string; message: string }): string {
  switch (e.reason) {
    case 'LOCKED': return `${e.message} Unlock it to edit.`;
    case 'CHILD_LOCKED': return `${e.message} Unlock it first.`;
    case 'GEOMETRY': return `Can't place it there: ${e.message}`;
    case 'EMPTY': return e.message;
    default: return e.message;
  }
}

function keepSelection(ids: string[], scene: SceneSpec) {
  const live = new Set(scene.objects.map((o) => o.id));
  const selectedIds = ids.filter((id) => live.has(id));
  return { selectedIds, selectedId: selectedIds[selectedIds.length - 1] ?? null };
}

// ---------------------------------------------------------------- loading
export function setScene(params: {
  source: SceneSource; roomName: string; shell: RoomShell; scene: SceneSpec; catalog: AssetCatalog;
}) {
  const ctx: OpContext = { shell: params.shell, assets: (id) => params.catalog.get(id) };
  set({
    source: params.source,
    roomName: params.roomName,
    shell: params.shell,
    workingScene: params.scene,
    catalog: params.catalog,
    assets: params.catalog.list(),
    loadError: null,
    selectedIds: [],
    selectedId: null,
    hoveredId: null,
    history: emptyHistory(EDITOR_POLICY.historyCap),
    save: { dirty: false, status: 'idle', lastError: null, baseRevision: params.scene.revision, pending: [] },
    violations: violationIndex(params.scene, ctx),
  });
}

// ---------------------------------------------------------------- committing
export type CommitResult = { ok: true } | { ok: false; error: OpError };

/**
 * The single mutation path: validate + apply contract ops through scene-engine, record ONE undo
 * entry, mark dirty (autosave subscribes to `save.pending`). Never called per frame.
 */
export function commit(label: string, ops: SceneOp[], opts: { quiet?: boolean; select?: string[] } = {}): CommitResult {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.workingScene || ops.length === 0) return { ok: false, error: { code: 'VALIDATION_ERROR', reason: 'INVALID_OP', message: 'No scene loaded.' } };
  const r = applyOps(ctx, s.workingScene, ops);
  if (!r.ok) {
    if (!opts.quiet) toast(describeOpError(r.error), 'warning');
    return { ok: false, error: r.error };
  }
  set({
    workingScene: r.scene,
    history: pushHistory(s.history, { label, forward: ops, inverse: r.inverse }),
    save: { ...s.save, dirty: true, pending: [...s.save.pending, ...ops] },
    violations: violationIndex(r.scene, ctx),
    ...keepSelection(opts.select ?? s.selectedIds, r.scene),
  });
  return { ok: true };
}

function step(kind: 'undo' | 'redo') {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.workingScene || s.dragging) return;
  const r = (kind === 'undo' ? undoHistory : redoHistory)(ctx, s.workingScene, s.history);
  if (!r.ok) {
    // Rejected (e.g. the object was locked since): the entry stays put — never skipped silently.
    toast(`Can't ${kind}: ${describeOpError(r.error)}`, r.error.reason === 'EMPTY' ? 'info' : 'warning');
    return;
  }
  set({
    workingScene: r.scene,
    history: r.history,
    save: { ...s.save, dirty: true, pending: [...s.save.pending, ...r.applied] },
    violations: violationIndex(r.scene, ctx),
    ...keepSelection(s.selectedIds, r.scene),
  });
}
export const undo = () => step('undo');
export const redo = () => step('redo');

// ---------------------------------------------------------------- selection
/** Members of the object's persistent group (or just the object). */
function withGroup(id: string): string[] {
  const o = objectById(id);
  if (!o?.groupId) return [id];
  return get().workingScene!.objects.filter((x) => x.groupId === o.groupId).map((x) => x.id).sort((a) => (a === id ? 1 : -1));
}

/**
 * Select an object. `additive` (Shift) toggles it in the selection; `single` (Alt) ignores its
 * persistent group. Clicking a grouped object selects the whole group.
 */
export function select(id: string | null, opts: { additive?: boolean; single?: boolean } = {}) {
  if (!id) return set({ selectedIds: [], selectedId: null });
  const ids = opts.single ? [id] : withGroup(id);
  if (opts.additive) {
    const cur = get().selectedIds;
    const all = ids.every((x) => cur.includes(x));
    const next = all ? cur.filter((x) => !ids.includes(x)) : [...cur.filter((x) => !ids.includes(x)), ...ids];
    return set({ selectedIds: next, selectedId: next[next.length - 1] ?? null });
  }
  set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null });
}

export const selectMany = (ids: string[], additive = false) => {
  const cur = additive ? get().selectedIds : [];
  const expanded = [...new Set(ids.flatMap((id) => withGroup(id)))];
  const next = [...cur.filter((x) => !expanded.includes(x)), ...expanded];
  set({ selectedIds: next, selectedId: next[next.length - 1] ?? null });
};

export const hover = (id: string | null) => {
  if (get().hoveredId !== id) set({ hoveredId: id });
};
export const setMode = (mode: TransformMode) => set({ mode });

export function toggleCollisions() {
  const off = !get().collisionsOff;
  set({ collisionsOff: off });
  toast(off ? 'Collisions off — things can overlap (still flagged in red).' : 'Collisions on.', 'info', 2200);
}

/** True when collisions are ignored for an edit: the toggle is off, or Ctrl/Cmd is held. */
export const ignoringCollisions = (held = false) => held || get().collisionsOff;

let camNonce = 0;
export const requestCamera = (preset: CameraPreset) => set({ cameraRequest: { type: 'preset', preset, nonce: ++camNonce } });
export const frameCamera = (target: 'selection' | 'room') => set({ cameraRequest: { type: 'frame', target, nonce: ++camNonce } });
export const focusCamera = (point: Vec3) => set({ cameraRequest: { type: 'focus', point, nonce: ++camNonce } });

// ---------------------------------------------------------------- object commands
const newId = () => crypto.randomUUID();
const ctxOrNull = () => {
  const s = get();
  const ctx = opContext(s);
  return ctx && s.workingScene ? { s, ctx, scene: s.workingScene } : null;
};

export function toggleLock(id?: string) {
  const objs = id ? [objectById(id)!].filter(Boolean) : selectedObjects();
  if (!objs.length) return;
  const lock = !objs.every((o) => o.locked);
  commit(lock ? 'Lock' : 'Unlock', objs.map((o) => ({ type: 'setLock', objectId: o.id, locked: lock }) as SceneOp));
}

export function setDecision(id: string, decision: RenovationDecision | null) {
  commit('Set plan decision', setOwnership(id, decision));
}

/** Delete the selection; whatever rests on deleted items settles to the next support below. */
export function deleteSelected() {
  const c = ctxOrNull();
  if (!c || !c.s.selectedIds.length) return;
  const roots = rootsOf(c.scene, c.s.selectedIds);
  let cur = c.scene;
  const ops: SceneOp[] = [];
  for (const r of roots) {
    const d = deleteWithSettle(c.ctx, cur, r.id);
    if (!d.ok) return toast(describeOpError(d.error), 'warning');
    const applied = applyOps({ ...c.ctx, geometry: 'report' }, cur, d.ops);
    if (!applied.ok) return toast(describeOpError(applied.error), 'warning');
    cur = applied.scene;
    ops.push(...d.ops);
  }
  if (commit('Delete', ops, { select: [] }).ok) {
    toast(roots.length === 1 ? `Deleted ${roots[0]!.displayName}` : `Deleted ${roots.length} items`);
  }
}

export function duplicateSelected() {
  const c = ctxOrNull();
  if (!c) return;
  const roots = rootsOf(c.scene, c.s.selectedIds);
  const primary = roots[roots.length - 1];
  if (!primary) return;
  const cls = classOf(c.ctx, primary);
  let delta: Vec2;
  if (cls === 'wall') {
    const near: Vec2 = [primary.transform.position[0], primary.transform.position[2]];
    const spot = findWallSpot(c.ctx, c.scene, { ...primary, id: '__dup__' }, near, primary.transform.position[1] + primary.dimensionsM[1] / 2);
    delta = [spot.position[0] - near[0], spot.position[2] - near[1]];
  } else if (roots.length === 1 && primary.placement?.parentId) {
    delta = [primary.dimensionsM[0] * 0.8, 0];
  } else {
    const spot = findFreeSpot(c.ctx, c.scene, { ...primary, id: '__dup__' }, [primary.transform.position[0], primary.transform.position[2]]);
    delta = [spot.position[0] - primary.transform.position[0], spot.position[2] - primary.transform.position[2]];
    if (!spot.found) toast('No free spot nearby — the copy is flagged.', 'warning');
  }
  const ops: SceneOp[] = [];
  const newRoots: string[] = [];
  for (const r of roots) {
    const dup = duplicateObject(c.scene, r.id, newId, delta);
    if (!dup) continue;
    ops.push(...dup.ops);
    newRoots.push(dup.rootId);
  }
  commit('Duplicate', ops, { select: newRoots });
}

/** Swap the display model of the same physical item (keeps the object id). */
export function swapAsset(id: string, assetId: string) {
  const s = get();
  const obj = objectById(id);
  const asset = s.catalog?.get(assetId);
  if (!obj || !asset) return;
  // Scan-reproduced items keep their measured size; library items take the new model's native size.
  const dims = obj.scanMatch ? obj.dimensionsM : asset.dimensionsM;
  if (commit('Swap model', setAsset(obj.id, asset.id, dims)).ok) toast(`Swapped to ${asset.title}`);
}

/**
 * Add a catalog asset near `point`. If `surfaceParentId` (or the surface under the point) can hold
 * it, it lands there; wall items go to the nearest wall; ceiling items hang; otherwise it's nudged
 * to the nearest free floor spot, or placed anyway and flagged.
 */
export function addAsset(assetId: string, point: Vec2, surfaceParentId?: string | null) {
  const c = ctxOrNull();
  const asset = c?.s.catalog?.get(assetId);
  if (!c || !asset) return;
  if (asset.licenseStatus !== 'verified') return toast(`${asset.title} isn't license-verified yet.`, 'warning');
  const probe = objectFromAsset(asset, newId(), [point[0], 0, point[1]]);
  const cls = classOf(c.ctx, probe);
  let obj: SceneObject;
  let found = true;
  if (cls === 'wall') {
    const spot = findWallSpot(c.ctx, c.scene, probe, point, EDITOR_POLICY.wallItemCenterHeightM);
    found = spot.found;
    obj = { ...probe, transform: makeTransform(spot.position, spot.yaw) };
  } else if (cls === 'ceiling') {
    obj = { ...probe, transform: makeTransform(ceilingPose(c.ctx.shell, probe.dimensionsM, point, 0.5).position, 0) };
  } else {
    const exclude = surfaceParentId ? new Set(c.scene.objects.filter((o) => o.id !== surfaceParentId).map((o) => o.id)) : undefined;
    const hit = findSupport(c.scene.objects, probe, { assets: c.ctx.assets }, { point, ...(exclude ? { exclude } : {}) });
    if (hit.ownerId) {
      const parent = objectById(hit.ownerId)!;
      obj = { ...probe, transform: makeTransform([point[0], hit.y, point[1]], yawFromQuat(parent.transform.rotation)), placement: { support: 'object', parentId: parent.id } };
    } else {
      const spot = findFreeSpot(c.ctx, c.scene, probe, point);
      found = spot.found;
      obj = { ...probe, transform: makeTransform(spot.position, 0) };
    }
  }
  const r = commit(`Add ${asset.title}`, [{ type: 'add', object: obj }], { select: [obj.id] });
  if (r.ok && !found) toast(`No free spot for ${asset.title} — placed and flagged.`, 'warning');
}

// ---------------------------------------------------------------- transform commands (keys / panel)

/** Move the selection horizontally by `delta` with block-and-slide, then settle. */
export function nudge(delta: Vec2, ignoreCollisions = ignoringCollisions()) {
  const c = ctxOrNull();
  if (!c || !c.s.selectedIds.length) return;
  const roots = rootsOf(c.scene, c.s.selectedIds).filter((o) => !o.locked);
  if (!roots.length) return toast('Locked items can’t be moved.', 'warning');
  let d = delta;
  if (!ignoreCollisions && EDITOR_POLICY.collision === 'block-and-slide') {
    const moving = bodiesOf(c.ctx, c.scene, movingSet(c.scene, roots.map((r) => r.id)));
    const obstacles = obstaclesFor(c.ctx, c.scene, roots.map((r) => r.id), { bounds: sweptBounds(moving, delta[0], delta[1]) });
    const res = resolveTranslation(moving, obstacles, [0, 0], delta);
    d = res.offset;
    if (Math.hypot(d[0], d[1]) < 1e-5 && res.blockers.length) return toast(`Blocked — hits ${res.blockers[0]!.label}`, 'info', 1500);
  }
  commit('Nudge', groupTransformOps(c.ctx, c.scene, roots.map((r) => r.id), d, 0, [0, 0]), { quiet: false });
}

/** Vertical nudge — wall/ceiling items, or items with Float on. */
export function nudgeVertical(dy: number) {
  const c = ctxOrNull();
  if (!c) return;
  const roots = rootsOf(c.scene, c.s.selectedIds).filter((o) => !o.locked);
  const movable = roots.filter((o) => {
    const cls = classOf(c.ctx, o);
    return cls === 'wall' || cls === 'ceiling' || o.placement?.float;
  });
  if (!movable.length) return toast('Turn on Float to raise or lower it (otherwise it settles back down).', 'info');
  const ops: SceneOp[] = movable.map((o) => {
    const [x, y, z] = o.transform.position;
    return { type: 'move', objectId: o.id, transform: { ...o.transform, position: [x, Math.max(c.ctx.shell.floor.elevationY, y + dy), z] } };
  });
  commit('Nudge up/down', ops);
}

/** Rotate the selection by `dYaw` about its centre (one object: about itself), respecting collisions. */
export function rotateSelectionBy(dYaw: number, ignoreCollisions = ignoringCollisions()) {
  const c = ctxOrNull();
  if (!c) return;
  const roots = rootsOf(c.scene, c.s.selectedIds).filter((o) => !o.locked && classOf(c.ctx, o) !== 'wall');
  if (!roots.length) return;
  const ids = roots.map((r) => r.id);
  const pivot = roots.length === 1 ? [roots[0]!.transform.position[0], roots[0]!.transform.position[2]] as Vec2 : selectionPivot(c.scene, ids);
  let offset: Vec2 = [0, 0];
  if (!ignoreCollisions && EDITOR_POLICY.collision === 'block-and-slide') {
    const all = [...movingSet(c.scene, ids)].map((id) => objectById(id)!);
    const rotated = all.map((o) => bodyAt({ ...o, transform: transformAbout(o, [0, 0], dYaw, pivot) }, c.ctx.assets));
    const obstacles = obstaclesFor(c.ctx, c.scene, ids, { bounds: sweptBounds(rotated, 0, 0) });
    const res = resolveRotation(rotated, obstacles);
    if (!res) return toast('Blocked — not enough room to turn it there.', 'info', 1500);
    offset = res.offset;
  }
  commit('Rotate', groupTransformOps(c.ctx, c.scene, ids, offset, dYaw, pivot, { settle: false }));
}

export function setYaw(id: string, yaw: number) {
  const o = objectById(id);
  if (!o) return;
  const cur = yawFromQuat(o.transform.rotation);
  set({ selectedIds: [id], selectedId: id });
  rotateSelectionBy(normalizeAngle(yaw - cur));
}

/**
 * Panel X/Y/Z entry. The piece travels horizontally from where it is toward the typed spot with
 * block-and-slide (unless collisions are off) and stops at the first obstacle. A typed height is kept
 * (the piece stays where you put it); otherwise it settles onto whatever is below. One undo entry.
 */
export function setPosition(id: string, target: Vec3) {
  const c = ctxOrNull();
  const o = objectById(id);
  if (!c || !o) return;
  if (o.locked) return toast(`${o.displayName} is locked.`, 'warning');
  const [ox, oy, oz] = o.transform.position;
  const desired: Vec2 = [target[0] - ox, target[2] - oz];
  let offset = desired;
  let blocker: string | null = null;
  if (!ignoringCollisions() && EDITOR_POLICY.collision === 'block-and-slide' && Math.hypot(desired[0], desired[1]) > 1e-6) {
    const moving = bodiesOf(c.ctx, c.scene, movingSet(c.scene, [id]));
    const obstacles = obstaclesFor(c.ctx, c.scene, [id], { bounds: sweptBounds(moving, desired[0], desired[1]) });
    const res = resolveTranslation(moving, obstacles, [0, 0], desired);
    offset = res.offset;
    if (Math.hypot(offset[0] - desired[0], offset[1] - desired[1]) > 0.01) blocker = res.blockers[0]?.label ?? 'something';
  }
  const raised = Math.abs(target[1] - oy) > 1e-4;
  const y = raised ? Math.max(c.ctx.shell.floor.elevationY, target[1]) : oy;
  const transform = { ...o.transform, position: [ox + offset[0], y, oz + offset[1]] as Vec3 };
  const r = commit('Move', moveWithSupport(c.ctx, c.scene, id, transform, { settle: !raised }));
  if (r.ok && blocker) toast(`Stopped short — it hits ${blocker}.`, 'info', 2200);
}

export function setFloat(id: string, float: boolean) {
  const c = ctxOrNull();
  const o = objectById(id);
  if (!c || !o) return;
  const placement = { ...(o.placement ?? { support: 'floor' as const }), ...(float ? { float: true } : {}) };
  if (!float) delete (placement as { float?: boolean }).float;
  const ops: SceneOp[] = [{ type: 'setPlacement', objectId: id, placement }];
  if (!float) {
    // Turning Float off lets it settle right away.
    const after = applyOps({ ...c.ctx, geometry: 'report' }, c.scene, ops);
    if (after.ok) ops.push(...moveWithSupport(c.ctx, after.scene, id, o.transform));
  }
  commit(float ? 'Float on' : 'Float off', ops);
}

export function setTilt(id: string, tilt: Tilt) {
  const c = ctxOrNull();
  if (!c) return;
  commit('Change orientation', tiltOps(c.ctx, c.scene, id, tilt));
}

export function resizeObject(id: string, dims: Vec3) {
  const c = ctxOrNull();
  if (!c) return;
  commit('Resize', resizeOps(c.ctx, c.scene, id, dims));
}

export function setVariant(id: string, overrides: SceneObject['materialOverrides'] | null) {
  commit('Change finish', [overrides ? { type: 'changeMaterial', objectId: id, overrides } : { type: 'changeMaterial', objectId: id }]);
}

export function toggleLight(id: string) {
  const o = objectById(id);
  if (!o) return;
  commit(o.lightOn === false ? 'Light on' : 'Light off', [{ type: 'setLight', objectId: id, on: o.lightOn === false }]);
}

export function groupSelected() {
  const ids = get().selectedIds;
  if (ids.length < 2) return toast('Select two or more items to group them.', 'info');
  if (commit('Group', [{ type: 'setGroup', objectIds: ids, groupId: newId() }]).ok) toast(`Grouped ${ids.length} items`);
}

export function ungroupSelected() {
  const ids = get().selectedIds.filter((id) => objectById(id)?.groupId);
  if (!ids.length) return;
  if (commit('Ungroup', [{ type: 'setGroup', objectIds: ids, groupId: null }]).ok) toast('Ungrouped');
}

export function setSceneSettings(settings: { lightingPreset?: string; appearance?: SceneAppearance }) {
  commit('Room settings', [{ type: 'setSceneSettings', ...settings }]);
}
