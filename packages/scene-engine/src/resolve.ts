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
  /** Horizontal distance from the suggested position, for "moved". */
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
      if (validateObject(placed, candidate, ctx).ok) return candidate;
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
  for (const o of draft.objects) {
    if (fixed.has(o.id)) continue;
    const scene = placedScene();
    if (validateObject(scene, o, ctx).ok) {
      final.set(o.id, o);
      report.push({ objectId: o.id, outcome: "applied" });
      continue;
    }
    const fit = o.locked ? null : nearestFit(scene, o, ctx);
    if (fit) {
      final.set(o.id, fit);
      const [x0, , z0] = o.transform.position;
      const [x1, , z1] = fit.transform.position;
      report.push({
        objectId: o.id,
        outcome: "moved",
        distanceM: Math.hypot(x1 - x0, z1 - z0),
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
