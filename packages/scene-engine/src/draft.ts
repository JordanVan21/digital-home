import type { Placement, SceneObject, SceneOp, SceneSpec, Transform } from '@house/contracts';
import { boundsOfBodies, bodyOf } from './collision';
import { settleWithGravity } from './contact';
import { applyOps, carryTransform, type OpContext } from './ops';
import { classOf, indexObjects, validateObject, type RuleId, type Violation } from './rules';

/**
 * Suggestions (drafts): every design edit lands in a draft that may contain conflicts. Accepting
 * resolves the draft into a valid scene and expresses the result as contract ops (a ScenePatch),
 * the same shape an AI proposal takes. Lock state is protection, not design, so it never counts
 * as a change.
 */

export type SceneDiff = { untouched: string[]; changed: string[]; added: string[]; removed: string[] };

/** JSON with sorted keys: schema parsing may reorder keys, which must not count as a change. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const comparable = (o: SceneObject) => stableStringify({ ...o, locked: false });

export function diffScenes(accepted: Pick<SceneSpec, 'objects'>, draft: Pick<SceneSpec, 'objects'>): SceneDiff {
  const before = new Map(accepted.objects.map((o) => [o.id, o]));
  const after = new Set(draft.objects.map((o) => o.id));
  const diff: SceneDiff = { untouched: [], changed: [], added: [], removed: [] };
  for (const o of draft.objects) {
    const prev = before.get(o.id);
    if (!prev) diff.added.push(o.id);
    else if (comparable(prev) === comparable(o)) diff.untouched.push(o.id);
    else diff.changed.push(o.id);
  }
  for (const o of accepted.objects) if (!after.has(o.id)) diff.removed.push(o.id);
  return diff;
}

export const hasDifferences = (d: SceneDiff) => d.changed.length + d.added.length + d.removed.length > 0;

// ---------------------------------------------------------------- scene → ops

const same = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);
const placementOf = (o: SceneObject): Placement => o.placement ?? { support: 'floor' };

/** Objects in support order: every parent before the things resting on it. */
function parentFirst(objects: readonly SceneObject[]): SceneObject[] {
  const index = indexObjects(objects);
  const out: SceneObject[] = [];
  const done = new Set<string>();
  const visit = (o: SceneObject, depth = 0) => {
    if (done.has(o.id) || depth > 64) return;
    const p = o.placement?.parentId ? index.get(o.placement.parentId) : undefined;
    if (p) visit(p, depth + 1);
    if (done.has(o.id)) return;
    done.add(o.id);
    out.push(o);
  };
  objects.forEach((o) => visit(o));
  return out;
}

export type DiffOpsResult = { ok: true; ops: SceneOp[] } | { ok: false; message: string };

/**
 * Contract ops that turn `from` into `to` (objects and scene settings; lock flags excluded).
 * Verified by applying them: the result must reproduce `to` exactly.
 */
export function diffToOps(ctx: OpContext, from: SceneSpec, to: SceneSpec): DiffOpsResult {
  const rctx: OpContext = { ...ctx, geometry: 'report' };
  const ops: SceneOp[] = [];
  let cur = from;
  const push = (op: SceneOp): string | null => {
    const r = applyOps(rctx, cur, [op]);
    if (!r.ok) return `${op.type}: ${r.error.message}`;
    cur = r.scene;
    ops.push(op);
    return null;
  };
  const target = indexObjects(to.objects);
  const now = () => indexObjects(cur.objects);

  // 1. Physical replacements, then additions (supports first).
  const fromIds = new Set(from.objects.map((o) => o.id));
  for (const o of parentFirst(to.objects)) {
    if (fromIds.has(o.id)) continue;
    const replaced = o.replacesObjectId;
    const err = replaced && fromIds.has(replaced) && !target.has(replaced) && now().has(replaced)
      ? push({ type: 'replacePhysicalItem', oldObjectId: replaced, newObject: o })
      : push({ type: 'add', object: o });
    if (err) return { ok: false, message: err };
  }

  // 2. Field changes on surviving objects, supports first.
  for (const t of parentFirst(to.objects)) {
    const c = now().get(t.id);
    if (!c) continue;
    const steps: SceneOp[] = [];
    if (!same(c.placement && placementOf(c), t.placement && placementOf(t))) steps.push({ type: 'setPlacement', objectId: t.id, placement: placementOf(t) });
    if (c.assetId !== t.assetId) steps.push({ type: 'replaceAsset', objectId: t.id, assetId: t.assetId, dimensionsM: t.dimensionsM });
    else if (!same(c.dimensionsM, t.dimensionsM)) steps.push({ type: 'resize', objectId: t.id, dimensionsM: t.dimensionsM });
    if (!same(c.materialOverrides, t.materialOverrides)) {
      steps.push(t.materialOverrides ? { type: 'changeMaterial', objectId: t.id, overrides: t.materialOverrides } : { type: 'changeMaterial', objectId: t.id });
    }
    if (!same(c.tilt, t.tilt)) steps.push({ type: 'setTilt', objectId: t.id, tilt: t.tilt ?? { x: 0, z: 0 } });
    if (!same(c.groupId, t.groupId)) steps.push({ type: 'setGroup', objectIds: [t.id], groupId: t.groupId ?? null });
    if ((c.lightOn ?? true) !== (t.lightOn ?? true)) steps.push({ type: 'setLight', objectId: t.id, on: t.lightOn ?? true });
    if (!same(c.renovationDecision, t.renovationDecision)) steps.push({ type: 'setRenovationDecision', objectId: t.id, decision: t.renovationDecision ?? null });
    for (const s of steps) {
      const err = push(s);
      if (err) return { ok: false, message: err };
    }
  }

  // 3. Removals: roots only (deleting a support deletes what still rests on it).
  for (const o of parentFirst(from.objects)) {
    if (target.has(o.id) || !now().has(o.id)) continue;
    const err = push({ type: 'delete', objectId: o.id });
    if (err) return { ok: false, message: err };
  }

  // 4. Transforms last, supports first: a move carries descendants, so each child is re-pinned after.
  for (const t of parentFirst(to.objects)) {
    const c = now().get(t.id);
    if (c && !same(c.transform, t.transform)) {
      const err = push({ type: 'move', objectId: t.id, transform: t.transform });
      if (err) return { ok: false, message: err };
    }
  }

  // 5. Scene-level settings.
  if (!same(cur.lightingPreset, to.lightingPreset) || !same(cur.appearance, to.appearance)) {
    const err = push({
      type: 'setSceneSettings',
      ...(cur.lightingPreset !== to.lightingPreset ? { lightingPreset: to.lightingPreset } : {}),
      ...(!same(cur.appearance, to.appearance) ? { appearance: to.appearance ?? {} } : {}),
    });
    if (err) return { ok: false, message: err };
  }

  const key = (s: SceneSpec) => stableStringify(s.objects.map((o) => ({ ...o, locked: false })).sort((a, b) => a.id.localeCompare(b.id)));
  if (key(cur) !== key(to)) return { ok: false, message: 'The draft has changes no scene operation can express.' };
  return { ok: true, ops };
}

// ---------------------------------------------------------------- conflicts

/** Violations a draft may contain but an accepted scene may not (newly introduced ones only). */
export const CONFLICT_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'inside_room', 'overlap', 'door_clearance', 'opening_overlap', 'support', 'nesting',
]);

const conflictKey = (v: Violation) => `${v.rule}:${v.otherId ?? ''}`;

function violationsOf(ctx: OpContext, objects: readonly SceneObject[], id: string): Violation[] {
  const index = indexObjects(objects);
  const o = index.get(id);
  return o ? validateObject(ctx, index, o).filter((v) => CONFLICT_RULES.has(v.rule)) : [];
}

/**
 * Conflicts of `id` in `draft` that it didn't already have in `accepted` (pre-existing scan
 * conflicts never block an unrelated edit). Keyed by piece id → violations.
 */
export function draftConflicts(ctx: OpContext, accepted: SceneSpec, draft: SceneSpec): Record<string, Violation[]> {
  const out: Record<string, Violation[]> = {};
  const diff = diffScenes(accepted, draft);
  for (const id of [...diff.changed, ...diff.added]) {
    const before = new Set(violationsOf(ctx, accepted.objects, id).map(conflictKey));
    const fresh = violationsOf(ctx, draft.objects, id).filter((v) => !before.has(conflictKey(v)));
    if (fresh.length) out[id] = fresh;
  }
  return out;
}

// ---------------------------------------------------------------- resolution

export type ResolutionEntry = {
  objectId: string;
  outcome: 'applied' | 'moved' | 'reverted' | 'dropped' | 'removed';
  /** Horizontal distance from the suggested position, for "moved". */
  distanceM?: number;
  /** How far gravity lowered (or lifted onto a surface) the piece. */
  settledM?: number;
};

export type DraftResolution =
  | { ok: true; scene: SceneSpec; report: ResolutionEntry[]; ops: SceneOp[] }
  | { ok: false; unresolved: { objectId: string; message: string }[] };

export type ResolveOptions = { stepM?: number; radiusM?: number };

/**
 * Project a draft into a valid scene. Suggesting breaks the rules freely; accepting turns them back
 * on, in order:
 * 1. Gravity: each moved or added piece (with the edited items resting on it, as one assembly)
 *    settles onto the surface beneath it, unless it's wall/ceiling-mounted, Float or locked.
 * 2. Collisions (resolver "option A"): untouched pieces never move. An assembly keeps its drop
 *    spot if it introduces no conflicts, else moves to the nearest conflict-free spot within
 *    `radiusM` (keeping its rotation, settling again there). Otherwise a changed piece reverts and
 *    an added piece is dropped. Locked and wall/ceiling pieces never search; they only revert.
 */
export function resolveDraft(ctx: OpContext, accepted: SceneSpec, draft: SceneSpec, opts: ResolveOptions = {}): DraftResolution {
  const step = opts.stepM ?? 0.05;
  const radius = opts.radiusM ?? 1.5;
  const diff = diffScenes(accepted, draft);
  const original = indexObjects(accepted.objects);
  const edited = new Set([...diff.changed, ...diff.added]);
  const final = new Map<string, SceneObject>();
  for (const o of draft.objects) if (!edited.has(o.id)) final.set(o.id, o);

  const priorKeys = new Map<string, Set<string>>();
  const prior = (id: string) => {
    let k = priorKeys.get(id);
    if (!k) priorKeys.set(id, (k = new Set(original.has(id) ? violationsOf(ctx, accepted.objects, id).map(conflictKey) : [])));
    return k;
  };

  const draftIndex = indexObjects(draft.objects);
  const childrenOf = (id: string) => draft.objects.filter((o) => o.placement?.parentId === id);
  const report: ResolutionEntry[] = [];
  const unresolved: { objectId: string; message: string }[] = [];
  const handled = new Set<string>();

  for (const o of parentFirst(draft.objects)) {
    if (!edited.has(o.id) || handled.has(o.id)) continue;
    // The assembly: this piece plus edited items resting on it (recursively).
    const members: SceneObject[] = [o];
    for (let i = 0; i < members.length; i++) {
      for (const c of childrenOf(members[i]!.id)) if (edited.has(c.id) && !handled.has(c.id)) members.push(c);
    }
    members.forEach((m) => handled.add(m.id));
    const memberIds = new Set(members.map((m) => m.id));

    const prev = original.get(o.id);
    const moved = !prev || !same(prev.transform, o.transform) || !same(prev.placement, o.placement);
    const gravity = moved && !o.locked;
    /** Gravity on the assembly root against what's placed so far; carried members follow. */
    const ground = (cands: SceneObject[]): SceneObject[] => {
      if (!gravity) return cands;
      const root = cands[0]!;
      const placed = [...final.values()].filter((p) => !memberIds.has(p.id));
      const settled = settleWithGravity(ctx, [...placed, ...cands.slice(1)], root).object;
      const dy = settled.transform.position[1] - root.transform.position[1];
      return cands.map((c, i) => (i === 0 ? settled
        : { ...c, transform: { ...c.transform, position: [c.transform.position[0], c.transform.position[1] + dy, c.transform.position[2]] } }));
    };
    const fits = (cands: SceneObject[]): boolean => {
      const objects = [...[...final.values()].filter((p) => !memberIds.has(p.id)), ...cands];
      const index = indexObjects(objects);
      const near = nearby(ctx, objects, cands);
      return cands.every((c) => {
        const vs = validateObject(ctx, index, c, near).filter((v) => CONFLICT_RULES.has(v.rule));
        const before = prior(c.id);
        return vs.every((v) => before.has(conflictKey(v)));
      });
    };
    const shifted = (dx: number, dz: number): SceneObject[] => {
      const to: Transform = { ...o.transform, position: [o.transform.position[0] + dx, o.transform.position[1], o.transform.position[2] + dz] };
      return members.map((m) => (m.id === o.id ? { ...m, transform: to } : { ...m, transform: carryTransform(m.transform, o.transform, to) }));
    };

    const atDrop = ground(members);
    let fit: SceneObject[] | null = fits(atDrop) ? atDrop : null;
    const searchable = !members.some((m) => m.locked) && classOf(ctx, o) !== 'wall' && classOf(ctx, o) !== 'ceiling';
    if (!fit && searchable) {
      search: for (let r = step; r <= radius + 1e-9; r += step) {
        const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const cand = ground(shifted(Math.cos(a) * r, Math.sin(a) * r));
          if (fits(cand)) { fit = cand; break search; }
        }
      }
    }
    if (fit) {
      for (const p of fit) {
        const was = draftIndex.get(p.id)!.transform.position;
        const d = Math.hypot(p.transform.position[0] - was[0], p.transform.position[2] - was[2]);
        // The nearest free spot can be exactly where it started: that's a revert.
        const prev = original.get(p.id);
        const home = prev && d > 1e-6
          && Math.hypot(p.transform.position[0] - prev.transform.position[0], p.transform.position[2] - prev.transform.position[2]) < 1e-6
          && comparable({ ...p, transform: prev.transform }) === comparable(prev);
        if (home) {
          final.set(p.id, { ...prev, locked: p.locked });
          report.push({ objectId: p.id, outcome: 'reverted' });
          continue;
        }
        final.set(p.id, p);
        const dy = p.transform.position[1] - draftIndex.get(p.id)!.transform.position[1];
        const settledM = Math.abs(dy) > 1e-4 ? { settledM: Math.abs(dy) } : {};
        report.push(d > 1e-6 ? { objectId: p.id, outcome: 'moved', distanceM: d, ...settledM } : { objectId: p.id, outcome: 'applied', ...settledM });
      }
      continue;
    }
    // Revert changed members (keeping the current lock flag); drop added ones.
    const reverted = members.flatMap((m) => {
      const prev = original.get(m.id);
      return prev ? [{ ...prev, locked: m.locked }] : [];
    });
    if (fits(reverted)) {
      for (const m of members) {
        const prev = reverted.find((r) => r.id === m.id);
        if (prev) final.set(m.id, prev);
        report.push({ objectId: m.id, outcome: prev ? 'reverted' : 'dropped' });
      }
      continue;
    }
    unresolved.push({ objectId: o.id, message: `Couldn't fit ${o.displayName} or put it back. Move something to make room.` });
  }
  if (unresolved.length) return { ok: false, unresolved };

  // Dropped supports take whatever was added onto them along.
  const kept = draft.objects.filter((o) => final.has(o.id) && (!o.placement?.parentId || final.has(o.placement.parentId)));
  for (const id of diff.removed) report.push({ objectId: id, outcome: 'removed' });
  const scene: SceneSpec = { ...draft, revision: accepted.revision, objects: kept.map((o) => final.get(o.id)!) };
  const patch = diffToOps(ctx, accepted, scene);
  if (!patch.ok) return { ok: false, unresolved: [{ objectId: draft.objects[0]?.id ?? '', message: patch.message }] };
  return { ok: true, scene, report, ops: patch.ops };
}

/** Broad-phase: objects whose bounds come within 0.5 m of any candidate. */
function nearby(ctx: OpContext, objects: readonly SceneObject[], cands: readonly SceneObject[]): SceneObject[] {
  const b = boundsOfBodies(cands.map((c) => bodyOf(c, ctx.assets)));
  const pad = 0.5;
  return objects.filter((o) => {
    const ob = bodyOf(o, ctx.assets);
    return ob.max[0] >= b.min[0] - pad && ob.min[0] <= b.max[0] + pad && ob.max[2] >= b.min[2] - pad && ob.min[2] <= b.max[2] + pad;
  });
}
