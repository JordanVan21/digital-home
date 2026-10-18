import type { SceneOp, SceneSpec } from '@house/contracts';
import { applyOps, type OpContext, type OpError } from './ops';

/**
 * Command-based undo/redo (not snapshots). Editor-local; never part of any timeline.
 * An entry stores the forward ops and the inverse that undoes them.
 */
export type HistoryEntry = { label: string; forward: SceneOp[]; inverse: SceneOp[] };
export type History = { past: HistoryEntry[]; future: HistoryEntry[]; cap: number };

export const emptyHistory = (cap = 100): History => ({ past: [], future: [], cap });

/** Record a newly applied command: caps the stack and clears redo. */
export function pushHistory(h: History, entry: HistoryEntry): History {
  const past = [...h.past, entry];
  return { ...h, past: past.length > h.cap ? past.slice(past.length - h.cap) : past, future: [] };
}

export type StepResult =
  | { ok: true; scene: SceneSpec; history: History; applied: SceneOp[]; entry: HistoryEntry }
  | { ok: false; error: OpError | { reason: 'EMPTY'; message: string }; history: History };

/**
 * Undo the latest entry. If its inverse is rejected (e.g. the object was locked since),
 * nothing changes: the entry stays in place and the error is returned for a toast.
 */
export function undo(ctx: OpContext, scene: SceneSpec, h: History): StepResult {
  const entry = h.past[h.past.length - 1];
  if (!entry) return { ok: false, error: { reason: 'EMPTY', message: 'Nothing to undo.' }, history: h };
  const r = applyOps({ ...ctx, geometry: 'report' }, scene, entry.inverse);
  if (!r.ok) return { ok: false, error: r.error, history: h };
  return {
    ok: true, scene: r.scene, applied: entry.inverse, entry,
    history: { ...h, past: h.past.slice(0, -1), future: [...h.future, entry] },
  };
}

export function redo(ctx: OpContext, scene: SceneSpec, h: History): StepResult {
  const entry = h.future[h.future.length - 1];
  if (!entry) return { ok: false, error: { reason: 'EMPTY', message: 'Nothing to redo.' }, history: h };
  const r = applyOps({ ...ctx, geometry: 'report' }, scene, entry.forward);
  if (!r.ok) return { ok: false, error: r.error, history: h };
  // Re-derive the inverse: identical in practice, but authoritative for the current state.
  const redone: HistoryEntry = { ...entry, inverse: r.inverse };
  return {
    ok: true, scene: r.scene, applied: entry.forward, entry: redone,
    history: { ...h, past: [...h.past, redone], future: h.future.slice(0, -1) },
  };
}
