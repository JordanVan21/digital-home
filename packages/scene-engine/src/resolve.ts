import { onNearestSurface } from "./support";
import type { SceneObject, SceneSpec } from "@house/contracts";
import { validateObject, type SceneContext } from "./operations";

export type SceneDiff = {
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

/** Nearest valid position on rings around the suggestion, keeping its rotation. */
function nearestFit(
  placed: SceneSpec,
  o: SceneObject,
  ctx: SceneContext,
): SceneObject | null {
  const [x, y, z] = o.transform.position;
  for (let r = SEARCH_STEP_M; r <= SEARCH_RADIUS_M + 1e-9; r += SEARCH_STEP_M) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / SEARCH_STEP_M));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const candidate: SceneObject = {
        ...o,
        transform: {
          ...o.transform,
          position: [x + Math.cos(a) * r, y, z + Math.sin(a) * r],
        },
      };
      const supported = onNearestSurface(placed, candidate, ctx.room);
      if (validateObject(placed, supported, ctx).ok) return supported;
    }
  }
  return null;
}

/**
 * Projects a draft into a valid scene. Untouched pieces are fixed; changed and
 * added pieces are placed in draft order, each validated against everything
 * placed before it. A colliding piece moves to the nearest fit, else a changed
 * piece reverts and an added piece is dropped. Locked pieces are never moved.
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
  for (const o of ordered) {
    if (fixed.has(o.id)) continue;
    const scene = placedScene();
    const supported = o.locked ? o : onNearestSurface(scene, o, ctx.room);
    if (validateObject(scene, supported, ctx).ok) {
      final.set(o.id, supported);
      const distanceM = Math.abs(
        supported.transform.position[1] - o.transform.position[1],
      );
      report.push({
        objectId: o.id,
        outcome: distanceM > 1e-5 ? "moved" : "applied",
        ...(distanceM > 1e-5 ? { distanceM } : {}),
      });
      continue;
    }
    const fit = o.locked ? null : nearestFit(scene, o, ctx);
    if (fit) {
      final.set(o.id, fit);
      const [x0, y0, z0] = o.transform.position;
      const [x1, y1, z1] = fit.transform.position;
      report.push({
        objectId: o.id,
        outcome: "moved",
        distanceM: Math.hypot(x1 - x0, y1 - y0, z1 - z0),
      });
      continue;
    }
    const prev = original.get(o.id);
    if (!prev) {
      report.push({ objectId: o.id, outcome: "dropped" });
      continue;
    }
    const reverted = { ...prev, locked: o.locked };
    if (validateObject(scene, reverted, ctx).ok) {
      final.set(o.id, reverted);
      report.push({ objectId: o.id, outcome: "reverted" });
      continue;
    }
    unresolved.push({
      objectId: o.id,
      message: `Couldn't fit ${o.displayName}. Move something to make room.`,
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
