import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  AssetSpec, RenovationDecision, RoomShell, SceneAppearance, SceneObject, SceneOp, SceneSpec, Tilt, Vec2, Vec3,
} from '@house/contracts';
import {
  applyOps, carryTransform, ceilingPose, classOf, diffScenes, draftConflicts, duplicateObject, emptyHistory,
  findFreeSpot, findSupport, findWallSpot, groupTransformOps, hasDifferences, makeTransform, normalizeAngle,
  objectFromAsset, placementFor, pushHistory, settleWithGravity, snapToSurface, redo as redoHistory, resizeOps, resolveDraft, rootsOf, selectionPivot, setAsset, setOwnership,
  stableStringify, stepYaw, subtreeIds, tiltOps, undo as undoHistory, validateScene, yawFromQuat,
  type History, type OpContext, type OpError, type ResolutionEntry, type Violation,
} from '@house/scene-engine';
import type { AssetCatalog } from '../catalog/AssetCatalog';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { makeLogEntry, type OpLogEntry, type OpSource } from './opLog';

export type SceneSource = 'demo-room' | 'demo-scan' | 'test2';
export type TransformMode = 'select' | 'translate' | 'rotate';
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

/**
 * Pending suggestions. Every design edit lands in a draft that may hold conflicts; Accept resolves
 * it into the accepted scene as one patch. Undo/redo hold the previous draft (null = no draft).
 */
export type DraftState = {
  undo: (SceneSpec | null)[];
  redo: (SceneSpec | null)[];
  /** Newly introduced conflicts per changed or added piece. */
  conflicts: Record<string, Violation[]>;
  /** Pieces the last Accept moved to fit, for a brief highlight. */
  resolved: string[];
};

export type ChangeKind = 'moved' | 'rotated' | 'replaced' | 'edited' | 'added' | 'removed';
export type Change = { id: string; kind: ChangeKind; name: string; distanceM?: number; degrees?: number; conflict?: string };

export type EditorState = {
  source: SceneSource;
  roomName: string;
  shell: RoomShell | null;
  /** The accepted room: autosaved, with editor history. */
  acceptedScene: SceneSpec | null;
  /** What the user sees and edits: the draft when there is one, otherwise the accepted scene. */
  workingScene: SceneSpec | null;
  hasDraft: boolean;
  draft: DraftState;
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
  /** Move tool plane: across the floor, or up/down (the height tool). */
  movePlane: 'floor' | 'height';
  /** Space held: drags move up/down. */
  heightModifier: boolean;
  dragging: boolean;
  walkMode: boolean;
  wallMode: WallMode;
  /** View-only: draw every piece's collision shape. */
  showColliders: boolean;
  // ---- history (editor-local; never a timeline)
  history: History;
  // ---- save
  save: SaveState;
  // ---- schema-typed edit log (newest last)
  opLog: OpLogEntry[];
  // ---- violations (committed scene), by object id
  violations: Record<string, Violation[]>;
  // ---- ui
  toasts: Toast[];
  libraryOpen: boolean;
  /** The library is open to replace the selected piece's model (same category). */
  replacing: boolean;
  /** Search text shared by the top-bar search and the library. */
  libraryQuery: string;
  inspectorOpen: boolean;
  hideUi: boolean;
  cameraRequest: CameraRequest | null;
  reference: { open: boolean; mode: 'pip' | 'full'; opacity: number };
};

const emptyDraft = (): DraftState => ({ undo: [], redo: [], conflicts: {}, resolved: [] });

const initial: EditorState = {
  source: 'demo-room',
  roomName: '',
  shell: null,
  acceptedScene: null,
  workingScene: null,
  hasDraft: false,
  draft: emptyDraft(),
  loadError: null,
  catalog: null,
  assets: [],
  selectedIds: [],
  selectedId: null,
  hoveredId: null,
  mode: 'translate',
  movePlane: 'floor',
  heightModifier: false,
  dragging: false,
  walkMode: false,
  wallMode: 'cutaway',
  showColliders: false,
  history: emptyHistory(EDITOR_POLICY.historyCap),
  save: { dirty: false, status: 'idle', lastError: null, baseRevision: 0, pending: [] },
  opLog: [],
  violations: {},
  toasts: [],
  libraryOpen: false,
  replacing: false,
  libraryQuery: '',
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

/** Append to the edit log (every mutation path calls this with the ops it applied). */
function log(source: OpSource, before: SceneSpec | null, ops: SceneOp[], note?: string) {
  set((st) => ({ opLog: [...st.opLog, makeLogEntry(source, before, ops, note)].slice(-200) }));
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
    acceptedScene: params.scene,
    workingScene: params.scene,
    hasDraft: false,
    draft: emptyDraft(),
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
  // StrictMode runs the load effect twice in development; log one load.
  if (get().opLog.at(-1)?.summary !== `Loaded ${params.roomName}`) log('immediate', null, [], `Loaded ${params.roomName}`);
}

// ---------------------------------------------------------------- committing
export type CommitResult = { ok: true } | { ok: false; error: OpError };

/**
 * Ops that protect or organise rather than redesign. They apply to the accepted room at once (and
 * to the draft), never as suggestions: a lock is protection, not a design change.
 */
const IMMEDIATE: ReadonlySet<SceneOp['type']> = new Set<SceneOp['type']>([
  'setLock', 'setRenovationDecision', 'setLight', 'setGroup', 'setSceneSettings',
]);

const noScene = (): CommitResult => ({ ok: false, error: { code: 'VALIDATION_ERROR', reason: 'INVALID_OP', message: 'No scene loaded.' } });

/**
 * The single mutation path. Design edits become suggestions in the draft (conflicts allowed;
 * locks and structural rules still enforced). Protective/organising ops commit immediately.
 * Never called per frame.
 */
export function commit(label: string, ops: SceneOp[], opts: { quiet?: boolean; select?: string[] } = {}): CommitResult {
  if (ops.length && ops.every((op) => IMMEDIATE.has(op.type))) return commitImmediate(label, ops, opts);
  return suggest(ops, opts);
}

/** Copies the accepted lock state onto a draft snapshot; locks are never suggestions. */
function withAcceptedLocks(scene: SceneSpec, accepted: SceneSpec): SceneSpec {
  const locks = new Map(accepted.objects.map((o) => [o.id, o.locked]));
  return { ...scene, objects: scene.objects.map((o) => (locks.has(o.id) && locks.get(o.id) !== o.locked ? { ...o, locked: locks.get(o.id)! } : o)) };
}

/** Installs `next` as the draft (or clears it when nothing differs from the accepted room). */
function setDraftScene(next: SceneSpec | null, stacks: Pick<DraftState, 'undo' | 'redo'>, select?: string[]) {
  const s = get();
  const ctx = opContext(s);
  const accepted = s.acceptedScene;
  if (!ctx || !accepted) return;
  const live = next && hasDifferences(diffScenes(accepted, next)) ? next : null;
  const working = live ?? accepted;
  set({
    workingScene: working,
    hasDraft: !!live,
    draft: { ...stacks, conflicts: live ? draftConflicts(ctx, accepted, live) : {}, resolved: [] },
    violations: violationIndex(working, ctx),
    ...keepSelection(select ?? s.selectedIds, working),
  });
}

function suggest(ops: SceneOp[], opts: { quiet?: boolean; select?: string[] }): CommitResult {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.workingScene || !ops.length) return noScene();
  const r = applyOps({ ...ctx, geometry: 'report' }, s.workingScene, ops);
  if (!r.ok) {
    if (!opts.quiet) toast(describeOpError(r.error), 'warning');
    return { ok: false, error: r.error };
  }
  const previous = s.hasDraft ? s.workingScene : null;
  setDraftScene(r.scene, { undo: [...s.draft.undo, previous].slice(-EDITOR_POLICY.historyCap), redo: [] }, opts.select);
  log('suggest', s.workingScene, ops);
  return { ok: true };
}

function commitImmediate(label: string, ops: SceneOp[], opts: { quiet?: boolean; select?: string[] }): CommitResult {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.acceptedScene || !s.workingScene) return noScene();
  // Pieces that exist only in the draft (added) take the op in the draft alone.
  const inAccepted = new Set(s.acceptedScene.objects.map((o) => o.id));
  const targets = (op: SceneOp): string[] => op.type === 'setGroup' ? op.objectIds : 'objectId' in op ? [op.objectId] : [];
  const acceptedOps = ops
    .map((op) => (op.type === 'setGroup' ? { ...op, objectIds: op.objectIds.filter((id) => inAccepted.has(id)) } : op))
    .filter((op) => (op.type === 'setGroup' ? op.objectIds.length > 0 : targets(op).every((id) => inAccepted.has(id))));
  let accepted = s.acceptedScene;
  let history = s.history;
  let pending = s.save.pending;
  if (acceptedOps.length) {
    const r = applyOps(ctx, accepted, acceptedOps);
    if (!r.ok) {
      if (!opts.quiet) toast(describeOpError(r.error), 'warning');
      return { ok: false, error: r.error };
    }
    accepted = r.scene;
    history = pushHistory(history, { label, forward: acceptedOps, inverse: r.inverse });
    pending = [...pending, ...acceptedOps];
  }
  let working = accepted;
  if (s.hasDraft) {
    // Mirror onto the draft op by op; ops on pieces the draft removed are skipped.
    let d = s.workingScene;
    for (const op of ops) {
      const r = applyOps({ ...ctx, geometry: 'report' }, d, [op]);
      if (r.ok) d = r.scene;
    }
    working = d;
  }
  set({
    acceptedScene: accepted,
    workingScene: working,
    history,
    save: acceptedOps.length ? { ...s.save, dirty: true, pending } : s.save,
    draft: s.hasDraft ? { ...s.draft, conflicts: draftConflicts(ctx, accepted, working) } : s.draft,
    violations: violationIndex(working, ctx),
    ...keepSelection(opts.select ?? s.selectedIds, working),
  });
  log('immediate', s.workingScene, ops);
  return { ok: true };
}

function summarize(report: ResolutionEntry[], name: (id: string) => string): string {
  const changed = report.filter((r) => r.outcome !== 'removed').length + report.filter((r) => r.outcome === 'removed').length;
  const parts = [`Applied ${changed} change${changed === 1 ? '' : 's'}`];
  for (const r of report) {
    if (r.outcome === 'moved') parts.push(`${name(r.objectId)} moved ${Math.round(r.distanceM! * 100)} cm to fit`);
    if (r.outcome === 'reverted') parts.push(`${name(r.objectId)} kept in place (no room)`);
    if (r.outcome === 'dropped') parts.push(`${name(r.objectId)} not added (no room)`);
    if (r.outcome !== 'reverted' && r.outcome !== 'dropped' && (r.settledM ?? 0) > 0.01) parts.push(`${name(r.objectId)} settled ${Math.round(r.settledM! * 100)} cm`);
  }
  return parts.join(' · ');
}

let resolvedTimer: ReturnType<typeof setTimeout> | undefined;

/** Resolve the draft into the accepted room: one history entry, one autosaved patch. */
export function accept(): boolean {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.acceptedScene || !s.workingScene || !s.hasDraft || s.dragging) return false;
  const before = s.acceptedScene;
  const proposed = s.workingScene;
  const r = resolveDraft(ctx, before, proposed);
  if (!r.ok) {
    const stuck = r.unresolved[0]!;
    if (proposed.objects.some((o) => o.id === stuck.objectId)) set({ selectedIds: [stuck.objectId], selectedId: stuck.objectId });
    toast(stuck.message, 'warning', 5000);
    return false;
  }
  const applied = applyOps({ ...ctx, geometry: 'report' }, before, r.ops);
  if (!applied.ok) {
    toast(describeOpError(applied.error), 'error');
    return false;
  }
  const after = applied.scene;
  const n = r.report.length;
  const moved = r.report.filter((e) => e.outcome === 'moved').map((e) => e.objectId);
  set({
    acceptedScene: after,
    workingScene: after,
    hasDraft: false,
    draft: { ...emptyDraft(), resolved: moved },
    history: r.ops.length ? pushHistory(s.history, { label: `Accept ${n} change${n === 1 ? '' : 's'}`, forward: r.ops, inverse: applied.inverse }) : s.history,
    save: r.ops.length ? { ...s.save, dirty: true, pending: [...s.save.pending, ...r.ops] } : s.save,
    violations: violationIndex(after, ctx),
    ...keepSelection(s.selectedIds, after),
  });
  const name = (id: string) => (proposed.objects.find((o) => o.id === id) ?? before.objects.find((o) => o.id === id))?.displayName ?? 'Item';
  log('accept', before, r.ops, `Accept: ScenePatch of ${r.ops.length} op${r.ops.length === 1 ? '' : 's'} · ${summarize(r.report, name)}`);
  toast(summarize(r.report, name), moved.length || r.report.some((e) => e.outcome === 'reverted' || e.outcome === 'dropped') ? 'warning' : 'info', 4500);
  clearTimeout(resolvedTimer);
  if (moved.length) resolvedTimer = setTimeout(() => set((st) => ({ draft: { ...st.draft, resolved: [] } })), 1600);
  return true;
}

/** Drop every suggestion (cannot be undone). */
export function discard() {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.acceptedScene || s.dragging) return;
  set({
    workingScene: s.acceptedScene,
    hasDraft: false,
    draft: emptyDraft(),
    violations: violationIndex(s.acceptedScene, ctx),
    ...keepSelection(s.selectedIds, s.acceptedScene),
  });
  if (s.hasDraft) log('discard', s.workingScene, [], 'Discarded all suggestions');
}

/** Same object up to float noise in its transform. */
function nearlySame(a: SceneObject, b: SceneObject): boolean {
  const ta = [...a.transform.position, ...a.transform.rotation];
  const tb = [...b.transform.position, ...b.transform.rotation];
  return ta.every((v, i) => Math.abs(v - tb[i]!) < 1e-6)
    && stableStringify({ ...a, transform: null }) === stableStringify({ ...b, transform: null });
}

/**
 * Revert one piece to its accepted state as a draft step: re-adds a removed piece (and what was
 * removed with it), removes an added one (returning anything placed on it), and restores carried
 * items that only followed their support.
 */
export function revertPiece(id: string) {
  const s = get();
  const accepted = s.acceptedScene;
  const current = s.workingScene;
  if (!accepted || !current || !s.hasDraft) return;
  const acc = new Map(accepted.objects.map((o) => [o.id, o]));
  const cur = new Map(current.objects.map((o) => [o.id, o]));
  const original = acc.get(id);
  const now = cur.get(id);
  let objects: SceneObject[];
  if (original && now) {
    objects = current.objects.map((o) => {
      if (o.id === id) return { ...original, locked: o.locked };
      const prev = acc.get(o.id);
      const parentNow = o.placement?.parentId;
      // A child that only followed this piece goes back with it.
      if (prev && parentNow && subtreeIds(current.objects, id).has(o.id)) {
        const followed = carryTransform(prev.transform, original.transform, now.transform);
        if (nearlySame(o, { ...prev, transform: followed, locked: o.locked })) return { ...prev, locked: o.locked };
      }
      return o;
    });
  } else if (original) {
    const gone = accepted.objects.filter((o) => (o.id === id || subtreeIds(accepted.objects, id).has(o.id)) && !cur.has(o.id));
    objects = [...current.objects, ...gone];
  } else {
    const sub = subtreeIds(current.objects, id);
    objects = current.objects.flatMap((o) => {
      if (!sub.has(o.id)) return [o];
      const prev = acc.get(o.id);
      return prev ? [{ ...prev, locked: o.locked }] : [];
    });
  }
  setDraftScene({ ...current, objects }, { undo: [...s.draft.undo, current], redo: [] });
  log('revert', current, [], `Reverted ${(now ?? original)?.displayName ?? 'a piece'}`);
}

const degreesBetween = (a: SceneObject, b: SceneObject) => {
  const d = ((yawFromQuat(b.transform.rotation) - yawFromQuat(a.transform.rotation)) * 180) / Math.PI;
  return ((((d + 180) % 360) + 360) % 360) - 180;
};

/** One row per changed piece in the draft, for the suggestions bar. */
export function changes(state = get()): Change[] {
  const accepted = state.acceptedScene;
  const draft = state.workingScene;
  if (!state.hasDraft || !accepted || !draft) return [];
  const before = new Map(accepted.objects.map((o) => [o.id, o]));
  const d = diffScenes(accepted, draft);
  const changed = new Set(d.changed);
  const rows: Change[] = [];
  for (const o of draft.objects) {
    const prev = before.get(o.id);
    let row: Change;
    if (!prev) row = { id: o.id, kind: 'added', name: o.displayName };
    else if (changed.has(o.id)) {
      const distanceM = Math.hypot(o.transform.position[0] - prev.transform.position[0], o.transform.position[2] - prev.transform.position[2]);
      const degrees = degreesBetween(prev, o);
      const kind: ChangeKind = prev.assetId !== o.assetId ? 'replaced' : distanceM > 0.005 ? 'moved' : Math.abs(degrees) > 0.5 ? 'rotated' : 'edited';
      row = {
        id: o.id, kind, name: o.displayName,
        ...(distanceM > 0.005 ? { distanceM } : {}),
        ...(Math.abs(degrees) > 0.5 ? { degrees } : {}),
      };
    } else continue;
    const conflict = state.draft.conflicts[o.id]?.[0];
    rows.push(conflict ? { ...row, conflict: conflict.detail } : row);
  }
  for (const id of d.removed) rows.push({ id, kind: 'removed', name: before.get(id)!.displayName });
  return rows;
}

function step(kind: 'undo' | 'redo') {
  const s = get();
  const ctx = opContext(s);
  if (!ctx || !s.workingScene || !s.acceptedScene || s.dragging) return;
  // Undo/redo walk the draft first, then accepted history.
  if (s.hasDraft || s.draft[kind].length) {
    const stack = s.draft[kind];
    if (!stack.length) return;
    const target = stack[stack.length - 1]!;
    const current = s.hasDraft ? s.workingScene : null;
    setDraftScene(
      target && withAcceptedLocks(target, s.acceptedScene),
      kind === 'undo'
        ? { undo: s.draft.undo.slice(0, -1), redo: [...s.draft.redo, current] }
        : { undo: [...s.draft.undo, current], redo: s.draft.redo.slice(0, -1) },
    );
    log(kind, s.workingScene, [], `${kind === 'undo' ? 'Undo' : 'Redo'} suggestion`);
    return;
  }
  const r = (kind === 'undo' ? undoHistory : redoHistory)(ctx, s.acceptedScene, s.history);
  if (!r.ok) {
    // Rejected (e.g. the object was locked since): the entry stays put — never skipped silently.
    toast(`Can't ${kind}: ${describeOpError(r.error)}`, r.error.reason === 'EMPTY' ? 'info' : 'warning');
    return;
  }
  set({
    acceptedScene: r.scene,
    workingScene: r.scene,
    history: r.history,
    save: { ...s.save, dirty: true, pending: [...s.save.pending, ...r.applied] },
    violations: violationIndex(r.scene, ctx),
    ...keepSelection(s.selectedIds, r.scene),
  });
  log(kind, s.acceptedScene, r.applied, `${kind === 'undo' ? 'Undo' : 'Redo'} “${r.entry.label}” (${r.applied.length} op${r.applied.length === 1 ? '' : 's'})`);
}
export const undo = () => step('undo');
export const redo = () => step('redo');

/** Whether undo/redo has anything to do (mirrors `step`). */
export function canTravel(kind: 'undo' | 'redo', s = get()): boolean {
  if (s.hasDraft || s.draft[kind].length) return s.draft[kind].length > 0;
  return kind === 'undo' ? s.history.past.length > 0 : s.history.future.length > 0;
}

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
export const setMode = (mode: TransformMode, movePlane: 'floor' | 'height' = 'floor') => set({ mode, movePlane });

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

/**
 * Delete the selection (a suggestion). Whatever rested on a deleted piece stays exactly where it
 * was, detached; gravity brings it down when the suggestions are accepted.
 */
export function deleteSelected() {
  const c = ctxOrNull();
  if (!c || !c.s.selectedIds.length) return;
  const roots = rootsOf(c.scene, c.s.selectedIds);
  const gone = new Set(roots.map((r) => r.id));
  const locked = roots.find((r) => r.locked);
  if (locked) return toast(`${locked.displayName} is locked. Unlock it to delete it.`, 'warning');
  const ops: SceneOp[] = [];
  for (const o of c.scene.objects) {
    const pid = o.placement?.parentId;
    if (pid && gone.has(pid) && !gone.has(o.id)) {
      const { parentId: _p, ...rest } = o.placement!;
      ops.push({ type: 'setPlacement', objectId: o.id, placement: { ...rest, support: rest.support === 'object' ? 'floor' : rest.support } });
    }
  }
  for (const r of roots) ops.push({ type: 'delete', objectId: r.id });
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

/** Move the selection horizontally by `delta` (a suggestion; conflicts resolve on Accept), then settle. */
export function nudge(delta: Vec2) {
  const c = ctxOrNull();
  if (!c || !c.s.selectedIds.length) return;
  const roots = rootsOf(c.scene, c.s.selectedIds).filter((o) => !o.locked);
  if (!roots.length) return toast('Locked items can’t be moved.', 'warning');
  commit('Nudge', groupTransformOps(c.ctx, c.scene, roots.map((r) => r.id), delta, 0, [0, 0], { settle: false }));
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

/** Rotate the selection by `dYaw` about its centre (one object: about itself), as a suggestion. */
export function rotateSelectionBy(dYaw: number) {
  const c = ctxOrNull();
  if (!c) return;
  const roots = rootsOf(c.scene, c.s.selectedIds).filter((o) => !o.locked && classOf(c.ctx, o) !== 'wall');
  if (!roots.length) return;
  const ids = roots.map((r) => r.id);
  const pivot = roots.length === 1 ? [roots[0]!.transform.position[0], roots[0]!.transform.position[2]] as Vec2 : selectionPivot(c.scene, ids);
  commit('Rotate', groupTransformOps(c.ctx, c.scene, ids, [0, 0], dYaw, pivot, { settle: false }));
}

/**
 * Step the selection to the next angle on the absolute grid (codex): ±15° by default (Q/E and the
 * inspector's − / +), 90° with Shift. The primary piece lands on the grid; others turn with it.
 */
export function stepRotation(dir: 1 | -1, stepRad = (15 * Math.PI) / 180) {
  const s = get();
  const primary = objectById(s.selectedId);
  if (!primary) return;
  const yaw = yawFromQuat(primary.transform.rotation);
  rotateSelectionBy(normalizeAngle(stepYaw(yaw, dir, stepRad) - yaw));
}

export function setYaw(id: string, yaw: number) {
  const o = objectById(id);
  if (!o) return;
  const cur = yawFromQuat(o.transform.rotation);
  set({ selectedIds: [id], selectedId: id });
  rotateSelectionBy(normalizeAngle(yaw - cur));
}

/**
 * Type an exact coordinate (the inspector's X / Y / Z fields): the piece goes exactly there. It rests
 * on whatever it then touches exactly; gravity applies only at Accept (unless Float is on).
 */
export function setPosition(id: string, axis: 0 | 1 | 2, value: number) {
  const c = ctxOrNull();
  const o = objectById(id);
  if (!c || !o || !Number.isFinite(value)) return;
  const position = [...o.transform.position] as Vec3;
  position[axis] = value;
  commit('Set position', contactMove(c.ctx, c.scene.objects, o, { ...o.transform, position }));
}

/**
 * A move plus the placement implied by exact contact (codex): resting on the face it touches, or
 * free when it touches nothing. Wall and ceiling items keep their mounting.
 */
export function contactMove(ctx: OpContext, objects: readonly SceneObject[], o: SceneObject, transform: SceneObject['transform']): SceneOp[] {
  const ops: SceneOp[] = [{ type: 'move', objectId: o.id, transform }];
  const cls = classOf(ctx, o);
  if (cls === 'wall' || cls === 'ceiling') return ops;
  const moved = { ...o, transform };
  const y = transform.position[1];
  // Exact contact: a designed support surface first (seat, shelf board, top), then any exposed face.
  const others = objects.filter((x) => x.id !== o.id);
  const designed = findSupport(others, moved, { assets: ctx.assets, floorY: ctx.shell.floor.elevationY }, { maxY: y + 1e-4 });
  const face = Math.abs(designed.y - y) < 1e-4 ? null : snapToSurface(ctx, others, moved, transform, 1e-4).surface;
  const hit = Math.abs(designed.y - y) < 1e-4 ? designed : face ? { ownerId: face.ownerId, surfaceId: 'contact', y: face.y } : null;
  const placement = placementFor(ctx, { ...o, placement: { ...(o.placement ?? { support: 'floor' }), parentId: undefined } }, hit);
  if (stableStringify(placement) !== stableStringify(o.placement ?? { support: 'floor' })) ops.push({ type: 'setPlacement', objectId: o.id, placement });
  return ops;
}

/** Put a piece down now (explicit gravity): it lands on the surface beneath it, Float off. */
export function placeOnSurface(id: string) {
  const c = ctxOrNull();
  const o = objectById(id);
  if (!c || !o) return;
  const { float: _f, ...placement } = o.placement ?? { support: 'floor' as const };
  const settled = settleWithGravity(c.ctx, c.scene.objects, { ...o, placement }).object;
  const ops: SceneOp[] = [{ type: 'move', objectId: id, transform: settled.transform }];
  if (stableStringify(settled.placement) !== stableStringify(o.placement ?? { support: 'floor' })) ops.push({ type: 'setPlacement', objectId: id, placement: settled.placement! });
  commit('Place on surface', ops);
}

export function setFloat(id: string, float: boolean) {
  const o = objectById(id);
  if (!o) return;
  const placement = { ...(o.placement ?? { support: 'floor' as const }), ...(float ? { float: true } : {}) };
  if (!float) delete (placement as { float?: boolean }).float;
  // Turning Float off doesn't drop it now: gravity applies when the suggestions are accepted.
  commit(float ? 'Float on' : 'Float off', [{ type: 'setPlacement', objectId: id, placement }]);
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
