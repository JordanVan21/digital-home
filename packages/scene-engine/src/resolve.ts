import { moveAssembly, supportedDescendants } from "./assembly";
import { onNearestSurface } from "./support";
import type { SceneObject, SceneSpec } from "@house/contracts";
import { validateObject, type SceneContext } from "./operations";

export type SceneDiff = {
  appearanceChanged: boolean;
  untouched: string[];
  changed: string[];
  added: string[];
  removed: string[];
};

export type ResolutionEntry = {
  objectId: string;
  outcome: "applied" | "moved" | "reverted" | "dropped" | "removed";
  /** Spatial distance from the suggested position, for "moved". */
  distanceM?: number;
};

export type ResolveResult =
  | { ok: true; scene: SceneSpec; report: ResolutionEntry[] }
  | { ok: false; unresolved: { objectId: string; message: string }[] };

/** Lock state is applied to both scenes directly, so it never counts as a change. */
const comparable = (o: SceneObject) => JSON.stringify({ ...o, locked: false });

export function diffScenes(accepted: SceneSpec, draft: SceneSpec): SceneDiff {
  const before = new Map(accepted.objects.map((o) => [o.id, o]));
  const after = new Set(draft.objects.map((o) => o.id));
  const diff: SceneDiff = {
    appearanceChanged: ["wallColor", "trimColor", "floorMaterial"].some(
      (key) =>
        accepted.appearance?.[
          key as keyof NonNullable<SceneSpec["appearance"]>
        ] !==
        draft.appearance?.[key as keyof NonNullable<SceneSpec["appearance"]>],
    ),
    untouched: [],
    changed: [],
    added: [],
    removed: [],
  };
  for (const o of draft.objects) {
    const prev = before.get(o.id);
    if (!prev) diff.added.push(o.id);
    else if (comparable(prev) === comparable(o)) diff.untouched.push(o.id);
    else diff.changed.push(o.id);
  }
  for (const o of accepted.objects)
    if (!after.has(o.id)) diff.removed.push(o.id);
  return diff;
}

const SEARCH_STEP_M = 0.05;
const SEARCH_RADIUS_M = 1.5;

/** Search the assembly as a unit; children never get separate fallback positions. */
function nearestFit(
  o: SceneObject,
  fitAt: (o: SceneObject) => SceneObject[] | null,
): SceneObject[] | null {
  const [x, y, z] = o.transform.position;
  for (let r = SEARCH_STEP_M; r <= SEARCH_RADIUS_M + 1e-9; r += SEARCH_STEP_M) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / SEARCH_STEP_M));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const fit = fitAt({
        ...o,
        transform: {
          ...o.transform,
          position: [x + Math.cos(a) * r, y, z + Math.sin(a) * r],
        },
      });
      if (fit) return fit;
    }
  }
  return null;
}

/**
 * Projects a draft into a valid scene. Untouched pieces are fixed; changed and
 * added pieces are placed in support order. Edited supports and attached edited
 * descendants are validated, searched and reverted as one assembly. Added groups
 * are dropped if they cannot fit. Locked pieces are never moved.
 */
export function resolveDraft(
  accepted: SceneSpec,
  draft: SceneSpec,
  ctx: SceneContext,
): ResolveResult {
  const diff = diffScenes(accepted, draft);
  const original = new Map(accepted.objects.map((o) => [o.id, o]));
  const fixed = new Set(diff.untouched);
  const final = new Map<string, SceneObject>();
  for (const o of draft.objects) if (fixed.has(o.id)) final.set(o.id, o);
  const placedScene = () => ({ ...draft, objects: [...final.values()] });

  const report: ResolutionEntry[] = [];
  const unresolved: { objectId: string; message: string }[] = [];
  // Resolve edited supports before their dependent children, preserving stable
  // array order otherwise. Cycles are still rejected by full validation.
  const ordered: SceneObject[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (o: SceneObject) => {
    if (done.has(o.id) || visiting.has(o.id)) return;
    visiting.add(o.id);
    const parent =
      o.placement?.support === "object"
        ? draft.objects.find((p) => p.id === o.placement?.parentId)
        : undefined;
    if (parent) visit(parent);
    visiting.delete(o.id);
    done.add(o.id);
    ordered.push(o);
  };
  draft.objects.forEach(visit);
  const edited = new Set([...diff.changed, ...diff.added]);
  const handled = new Set<string>();
  for (const o of ordered) {
    if (fixed.has(o.id) || handled.has(o.id)) continue;
    const ids = supportedDescendants(draft, o.id);
    const members = draft.objects.filter(
      (p) => p.id === o.id || (ids.has(p.id) && edited.has(p.id)),
    );
    members.forEach((p) => handled.add(p.id));
    const scene = placedScene();
    const fitAt = (candidate: SceneObject): SceneObject[] | null => {
      const supported = candidate.locked
        ? candidate
        : onNearestSurface(scene, candidate, ctx.room, ctx.assets);
      const moved = moveAssembly(
        { ...draft, objects: members },
        o.id,
        supported.transform,
      ).objects.map((p) => (p.id === o.id ? supported : p));
      if (
        moved.some(
          (p) =>
            p.locked &&
            JSON.stringify(p.transform) !==
              JSON.stringify(members.find((m) => m.id === p.id)!.transform),
        )
      )
        return null;
      const complete = { ...scene, objects: [...scene.objects, ...moved] };
      return moved.every((p) => validateObject(complete, p, ctx).ok)
        ? moved
        : null;
    };
    const fit =
      fitAt(o) ?? (members.some((p) => p.locked) ? null : nearestFit(o, fitAt));
    if (fit) {
      for (const p of fit) {
        final.set(p.id, p);
        const before = members.find((m) => m.id === p.id)!;
        const distanceM = Math.hypot(
          ...p.transform.position.map(
            (n, i) => n - before.transform.position[i],
          ),
        );
        report.push({
          objectId: p.id,
          outcome: distanceM > 1e-5 ? "moved" : "applied",
          ...(distanceM > 1e-5 ? { distanceM } : {}),
        });
      }
      continue;
    }
    const reverted = members.flatMap((p) => {
      const prev = original.get(p.id);
      return prev ? [{ ...prev, locked: p.locked }] : [];
    });
    const complete = { ...scene, objects: [...scene.objects, ...reverted] };
    if (reverted.every((p) => validateObject(complete, p, ctx).ok)) {
      for (const p of members) {
        const prev = reverted.find((r) => r.id === p.id);
        if (prev) final.set(p.id, prev);
        report.push({ objectId: p.id, outcome: prev ? "reverted" : "dropped" });
      }
      continue;
    }
    unresolved.push({
      objectId: o.id,
      message: `Couldn't fit ${o.displayName} and its snapped items. Move something to make room.`,
    });
  }
  // Support changes can invalidate untouched children. Never silently move them.
  const complete = placedScene();
  for (const o of complete.objects) {
    const validation = validateObject(complete, o, ctx);
    if (!validation.ok && !unresolved.some((u) => u.objectId === o.id))
      unresolved.push({
        objectId: o.id,
        message: `${o.displayName}: ${validation.error.message}`,
      });
  }
  if (unresolved.length) return { ok: false, unresolved };
  for (const id of diff.removed)
    report.push({ objectId: id, outcome: "removed" });
  if (diff.appearanceChanged)
    report.push({ objectId: draft.roomId, outcome: "applied" });
  return {
    ok: true,
    scene: {
      ...draft,
      objects: draft.objects.flatMap((o) => final.get(o.id) ?? []),
      revision: accepted.revision + 1,
    },
    report,
  };
}
