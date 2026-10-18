import type { SceneOp } from '@house/contracts';
import { EDITOR_POLICY } from '../config/editorPolicy';
import type { ScenePersistence } from '../persistence/ScenePersistence';
import { useEditor } from './store';

/**
 * Debounced, serialized autosave of committed ops via `saveScenePatch`.
 * - Fires once ~500 ms after the last committed change; never mid-drag.
 * - One request in flight at a time; ops committed meanwhile go in the next batch.
 * - A failed batch is retried with the SAME idempotency key, so retries never create duplicate revisions.
 * - On conflict, autosave stops; local edits are kept and never silently overwrite newer state.
 */
export function startAutosave(persistence: ScenePersistence, debounceMs: number = EDITOR_POLICY.autosaveDebounceMs) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight = false;
  /** Batch awaiting acknowledgement; reused verbatim on retry. */
  let batch: { key: string; ops: SceneOp[]; roomId: string } | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  async function flush() {
    timer = null;
    const s = useEditor.getState();
    if (!s.workingScene || inflight || s.save.status === 'conflict') return;
    if (s.dragging) return; // drag end re-triggers via the `dragging` subscription
    if (!batch) {
      if (s.save.pending.length === 0) return;
      batch = { key: crypto.randomUUID(), ops: s.save.pending.slice(), roomId: s.workingScene.roomId };
    }
    inflight = true;
    useEditor.setState((st) => ({ save: { ...st.save, status: 'saving', lastError: null } }));
    const sent = batch;
    try {
      const res = await persistence.saveScenePatch({
        roomId: sent.roomId,
        baseRevision: useEditor.getState().save.baseRevision,
        idempotencyKey: sent.key,
        operations: sent.ops,
      });
      inflight = false;
      const st = useEditor.getState();
      if (st.workingScene?.roomId !== sent.roomId) { batch = null; return; } // scene switched meanwhile
      if (res.ok) {
        batch = null;
        const pending = st.save.pending.slice(sent.ops.length);
        const stamp = <T extends { revision: number; updatedAt: string }>(x: T): T => ({ ...x, revision: res.revision, updatedAt: res.scene.updatedAt });
        const accepted = st.acceptedScene ? stamp(st.acceptedScene) : st.acceptedScene;
        useEditor.setState({
          acceptedScene: accepted,
          workingScene: st.hasDraft ? stamp(st.workingScene) : accepted,
          save: { ...st.save, baseRevision: res.revision, pending, dirty: pending.length > 0, status: pending.length ? 'saving' : 'saved', lastError: null },
        });
        if (pending.length) schedule();
      } else if (res.code === 'CONFLICT') {
        batch = null;
        useEditor.setState({ save: { ...st.save, status: 'conflict', lastError: `This room was changed elsewhere (revision ${res.currentRevision}). Your edits are kept locally.` } });
      } else {
        batch = null;
        useEditor.setState({ save: { ...st.save, status: 'error', lastError: res.message } });
      }
    } catch (e) {
      inflight = false;
      // Keep `batch` (same idempotency key) for the retry; keep local edits.
      useEditor.setState((st) => ({ save: { ...st.save, status: 'error', lastError: e instanceof Error ? e.message : String(e) } }));
    }
  }

  const unsubPending = useEditor.subscribe((s) => s.save.pending, (pending, prev) => {
    if (pending.length > prev.length) schedule();
  });
  const unsubDrag = useEditor.subscribe((s) => s.dragging, (dragging) => {
    if (dragging) {
      if (timer) clearTimeout(timer);
      timer = null;
    } else if (useEditor.getState().save.pending.length) schedule();
  });

  return {
    /** Manual retry after an error (same batch / idempotency key). */
    retry: () => {
      useEditor.setState((st) => ({ save: { ...st.save, status: 'saving' } }));
      void flush();
    },
    /** Drop any unsent batch (used when the scene is reloaded after a conflict). */
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      batch = null;
    },
    flushNow: () => flush(),
    stop: () => {
      if (timer) clearTimeout(timer);
      unsubPending();
      unsubDrag();
    },
  };
}

export type Autosave = ReturnType<typeof startAutosave>;
