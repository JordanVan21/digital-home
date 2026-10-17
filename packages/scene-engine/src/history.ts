import type { SceneOp, SceneSpec } from "@house/contracts";
import {
  applyOp,
  invertOp,
  type ApplyResult,
  type Inverse,
  type SceneContext,
} from "./operations";
export interface HistoryEntry {
  op: SceneOp;
  inverse: Inverse;
  before: SceneSpec;
  after: SceneSpec;
}
export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  limit: number;
}
export const createHistory = (limit = 80): History => ({
  undo: [],
  redo: [],
  limit: Math.max(1, limit),
});
export function record(
  history: History,
  before: SceneSpec,
  op: SceneOp,
  after: SceneSpec,
): History {
  return {
    ...history,
    undo: [
      ...history.undo,
      { op: structuredClone(op), inverse: invertOp(before, op), before, after },
    ].slice(-history.limit),
    redo: [],
  };
}
export function traverseHistory(
  scene: SceneSpec,
  history: History,
  direction: "undo" | "redo",
  ctx: SceneContext,
): ApplyResult & { history?: History } {
  const entry = history[direction].at(-1);
  if (!entry) return { ok: true, scene, history };
  // History owns immutable checkpoints to preserve array order and metadata exactly.
  // Validate the inverse when representable; checkpoint restore is local history, never an external scene op.
  const candidate = direction === "undo" ? entry.inverse : entry.op;
  if (candidate.type !== "checkpoint") {
    const result = applyOp(scene, candidate, ctx);
    if (!result.ok) return result;
  }
  const snapshot = direction === "undo" ? entry.before : entry.after;
  const next = {
    ...structuredClone(snapshot),
    revision: scene.revision + 1,
    updatedAt: scene.updatedAt,
  };
  return {
    ok: true,
    scene: next,
    history: {
      ...history,
      undo:
        direction === "undo"
          ? history.undo.slice(0, -1)
          : [...history.undo, entry].slice(-history.limit),
      redo:
        direction === "redo"
          ? history.redo.slice(0, -1)
          : [...history.redo, entry].slice(-history.limit),
    },
  };
}
