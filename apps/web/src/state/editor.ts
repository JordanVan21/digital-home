import { createStore } from "zustand/vanilla";
import {
  assetById,
  createFixtureScene,
  roomShell,
  type AssetSpec,
  type SceneObject,
  type SceneOp,
  type SceneSpec,
  type Transform,
  type Vec3,
} from "@house/contracts";
import {
  applyOp,
  moveAssembly,
  supportedDescendants,
  createHistory,
  diffScenes,
  record,
  recordCheckpoint,
  resolveDraft,
  snapToSurface,
  traverseHistory,
  validateObject,
  validateOp,
  yawOf,
  type History,
  type ResolutionEntry,
  type SceneContext,
} from "@house/scene-engine";
import {
  Autosave,
  LocalStorageSceneRepository,
  type SaveState,
  type SceneRepository,
} from "./repository";
export type Tool = "select" | "move" | "rotate";
export type Interaction = {
  selectedId: string | null;
  hoveredId: string | null;
  dragging: boolean;
  tool: Tool;
  movePlane: "floor" | "height";
  heightModifier: boolean;
  browser: boolean;
  replacing: boolean;
  inspector: boolean;
  resetView: number;
  toast: string | null;
  /** View-only lighting preset override; null uses the room's own preset. */
  lighting: string | null;
  /** Visual-only view toggles; nothing renders differently yet. */
  planView: boolean;
  measurements: boolean;
  boundingBoxes: boolean;
};
/**
 * Pending suggestions. `scene` is null when there are none. Undo/redo hold the
 * previous draft (null meaning "no draft") for each suggestion step.
 */
export type Draft = {
  scene: SceneSpec | null;
  undo: (SceneSpec | null)[];
  redo: (SceneSpec | null)[];
  /** Conflict message per changed or added piece, from full validation. */
  conflicts: Record<string, string>;
  /** Pieces the last accept moved to fit, for a brief highlight. */
  resolved: string[];
};
export type ChangeKind = "moved" | "rotated" | "replaced" | "added" | "removed";
export type Change = {
  id: string;
  kind: ChangeKind;
  name: string;
  distanceM?: number;
  degrees?: number;
  conflict?: string;
};
const emptyDraft = (): Draft => ({
  scene: null,
  undo: [],
  redo: [],
  conflicts: {},
  resolved: [],
});
function conflictsOf(accepted: SceneSpec, draft: SceneSpec | null) {
  const conflicts: Record<string, string> = {};
  if (!draft) return conflicts;
  const diff = diffScenes(accepted, draft);
  for (const id of [...diff.changed, ...diff.added]) {
    const o = draft.objects.find((o) => o.id === id)!;
    const r = validateObject(draft, o, sceneContext);
    if (!r.ok) conflicts[id] = r.error.message;
  }
  return conflicts;
}
const degreesBetween = (a: SceneObject, b: SceneObject) => {
  const d =
    ((yawOf(b.transform.rotation) - yawOf(a.transform.rotation)) * 180) /
    Math.PI;
  return ((((d + 180) % 360) + 360) % 360) - 180;
};
function summarize(
  report: ResolutionEntry[],
  accepted: SceneSpec,
  proposed: SceneSpec,
): string {
  const name = (id: string) =>
    (proposed.objects.find((o) => o.id === id) ??
      accepted.objects.find((o) => o.id === id))!.displayName;
  const parts = [
    `Applied ${report.length} change${report.length === 1 ? "" : "s"}`,
  ];
  for (const r of report) {
    if (r.outcome === "moved")
      parts.push(
        `${name(r.objectId)} moved ${Math.round(r.distanceM! * 100)} cm to fit`,
      );
    if (r.outcome === "reverted")
      parts.push(`${name(r.objectId)} kept in place (no room)`);
    if (r.outcome === "dropped")
      parts.push(`${name(r.objectId)} not added (no room)`);
  }
  return parts.join(" · ");
}
export const sceneContext: SceneContext = {
  room: roomShell,
  assets: assetById,
  roomId: createFixtureScene().roomId,
};
export function createEditor(repository?: SceneRepository) {
  const scene = createStore<{ scene: SceneSpec; ready: boolean }>(() => ({
    scene: createFixtureScene(),
    ready: !repository,
  }));
  const interaction = createStore<Interaction>(() => ({
    selectedId: null,
    hoveredId: null,
    dragging: false,
    tool: "select",
    movePlane: "floor",
    heightModifier: false,
    browser: false,
    replacing: false,
    inspector: true,
    resetView: 0,
    toast: null,
    lighting: null,
    planView: false,
    measurements: false,
    boundingBoxes: false,
  }));
  const history = createStore<{ history: History }>(() => ({
    history: createHistory(),
  }));
  const save = createStore<SaveState>(() => ({ status: "saved", error: null }));
  const draft = createStore<Draft>(emptyDraft);
  /** The scene the user sees and edits: the draft if any, else the accepted room. */
  const working = () => draft.getState().scene ?? scene.getState().scene;
  // Transient transforms are read by the frame loop; pointer moves never notify React.
  const motion = { transforms: new Map<string, Transform>() };
  const clearMotion = () => motion.transforms.clear();
  const previewMove = (id: string, transform: Transform) => {
    const before = working();
    const moved = moveAssembly(before, id, transform);
    motion.transforms = new Map(
      moved.objects.flatMap((o, i) =>
        o === before.objects[i] ? [] : [[o.id, o.transform] as const],
      ),
    );
  };
  const setDraft = (
    next: SceneSpec | null,
    stacks: Pick<Draft, "undo" | "redo">,
  ) => {
    const accepted = scene.getState().scene;
    // A draft with no remaining differences is no draft at all.
    const d = next && diffScenes(accepted, next);
    const empty =
      !d || (!d.changed.length && !d.added.length && !d.removed.length);
    const value = empty ? null : next;
    draft.setState({
      scene: value,
      ...stacks,
      conflicts: conflictsOf(accepted, value),
    });
  };
  /** Copies accepted lock state onto a draft snapshot; locks are never suggestions. */
  const withAcceptedLocks = (s: SceneSpec | null) => {
    if (!s) return s;
    const locks = new Map(
      scene.getState().scene.objects.map((o) => [o.id, o.locked]),
    );
    return {
      ...s,
      objects: s.objects.map((o) =>
        locks.has(o.id) && locks.get(o.id) !== o.locked
          ? { ...o, locked: locks.get(o.id)! }
          : o,
      ),
    };
  };
  let autosave: Autosave | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (message: string) => {
    interaction.setState({ toast: message });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => interaction.setState({ toast: null }), 3600);
  };
  const commit = (op: SceneOp): boolean => {
    if (!scene.getState().ready) return false;
    const before = scene.getState().scene;
    const result = applyOp(before, op, sceneContext);
    if (!result.ok) {
      notify(result.error.message);
      return false;
    }
    const after = { ...result.scene, updatedAt: new Date().toISOString() };
    scene.setState({ scene: after });
    history.setState({
      history: record(history.getState().history, before, op, after),
    });
    autosave?.schedule();
    return true;
  };
  /** Applies an edit to the draft. Conflicts are allowed; hard errors are not. */
  const suggest = (op: SceneOp, options: { snap?: boolean } = {}): boolean => {
    if (!scene.getState().ready) return false;
    if (op.type === "move" && options.snap !== false) {
      const move = op;
      const object = working().objects.find((o) => o.id === move.objectId);
      if (
        object &&
        object.transform.position.some(
          (v, i) => v !== move.transform.position[i],
        )
      )
        op = {
          ...op,
          transform: snapToSurface(
            working(),
            object,
            op.transform,
            sceneContext.room,
          ).transform,
        };
    }
    const previous = draft.getState().scene;
    const result = applyOp(working(), op, sceneContext, {
      allowConflicts: true,
    });
    if (!result.ok) {
      notify(result.error.message);
      return false;
    }
    setDraft(result.scene, {
      undo: [...draft.getState().undo, previous].slice(-80),
      redo: [],
    });
    return true;
  };
  const accept = (): boolean => {
    const proposed = draft.getState().scene;
    if (!proposed || interaction.getState().dragging) return false;
    const before = scene.getState().scene;
    const result = resolveDraft(before, proposed, sceneContext);
    if (!result.ok) {
      const stuck = result.unresolved[0];
      select(stuck.objectId);
      notify(stuck.message);
      return false;
    }
    const after = { ...result.scene, updatedAt: new Date().toISOString() };
    scene.setState({ scene: after });
    history.setState({
      history: recordCheckpoint(history.getState().history, before, after),
    });
    const moved = result.report.filter((r) => r.outcome === "moved");
    draft.setState({ ...emptyDraft(), resolved: moved.map((r) => r.objectId) });
    if (!after.objects.some((o) => o.id === interaction.getState().selectedId))
      select(null);
    autosave?.schedule();
    notify(summarize(result.report, before, proposed));
    return true;
  };
  const discard = () => {
    draft.setState(emptyDraft());
    if (
      !working().objects.some((o) => o.id === interaction.getState().selectedId)
    )
      select(null);
  };
  /** Reverts one piece to its accepted state (or removes it if added), as a draft step. */
  const revertPiece = (id: string) => {
    const current = draft.getState().scene;
    if (!current) return;
    const original = scene.getState().scene.objects.find((o) => o.id === id);
    let objects: SceneObject[];
    const root = current.objects.find((o) => o.id === id);
    if (original && root) {
      const result = applyOp(
        current,
        { type: "move", objectId: id, transform: original.transform },
        sceneContext,
        { allowConflicts: true },
      );
      if (!result.ok) {
        notify(result.error.message);
        return;
      }
      const accepted = scene.getState().scene;
      const projected = moveAssembly(accepted, id, root.transform);
      objects = result.scene.objects.map((o) => {
        if (o.id === id) return original;
        const prev = accepted.objects.find((p) => p.id === o.id);
        const expected = projected.objects.find((p) => p.id === o.id);
        const actual = current.objects.find((p) => p.id === o.id);
        const near = (a: Transform, b: Transform) =>
          [...a.position, ...a.rotation, ...a.scale].every(
            (n, i) =>
              Math.abs(n - [...b.position, ...b.rotation, ...b.scale][i]) <
              1e-9,
          );
        // Restore exact coordinates when a child only followed the parent; retain independent edits.
        return prev &&
          expected &&
          actual &&
          near(actual.transform, expected.transform)
          ? { ...o, transform: prev.transform }
          : o;
      });
    } else if (original) objects = [...current.objects, original];
    else {
      const ids = supportedDescendants(current, id);
      ids.add(id);
      objects = current.objects.flatMap((o) =>
        !ids.has(o.id)
          ? [o]
          : scene.getState().scene.objects.filter((p) => p.id === o.id),
      );
    }
    setDraft(
      { ...current, objects, revision: current.revision + 1 },
      { undo: [...draft.getState().undo, current], redo: [] },
    );
  };
  const changes = (): Change[] => {
    const proposed = draft.getState().scene;
    if (!proposed) return [];
    const accepted = scene.getState().scene;
    const before = new Map(accepted.objects.map((o) => [o.id, o]));
    const { conflicts } = draft.getState();
    const d = diffScenes(accepted, proposed);
    const rows: Change[] = [];
    for (const o of proposed.objects) {
      const prev = before.get(o.id);
      if (!prev) {
        rows.push({ id: o.id, kind: "added", name: o.displayName });
      } else if (d.changed.includes(o.id)) {
        const [x0, , z0] = prev.transform.position;
        const [x1, , z1] = o.transform.position;
        const distanceM = Math.hypot(x1 - x0, z1 - z0);
        const degrees = degreesBetween(prev, o);
        const kind: ChangeKind =
          prev.assetId !== o.assetId
            ? "replaced"
            : distanceM > 0.005
              ? "moved"
              : "rotated";
        rows.push({
          id: o.id,
          kind,
          name: o.displayName,
          distanceM: distanceM > 0.005 ? distanceM : undefined,
          degrees: Math.abs(degrees) > 0.5 ? degrees : undefined,
        });
      } else continue;
      const conflict = conflicts[o.id];
      if (conflict) rows[rows.length - 1].conflict = conflict;
    }
    for (const id of d.removed)
      rows.push({ id, kind: "removed", name: before.get(id)!.displayName });
    return rows;
  };
  const selected = () =>
    working().objects.find((o) => o.id === interaction.getState().selectedId);
  const select = (id: string | null) =>
    interaction.setState({ selectedId: id });
  const rotate = (direction = 1) => {
    const obj = selected();
    if (!obj) return;
    const yaw =
      ((Math.round(yawOf(obj.transform.rotation) / (Math.PI / 12)) +
        direction) *
        Math.PI) /
      12;
    setYaw(yaw);
  };
  /** Free swivel: sets the selected piece's yaw (radians) as a suggestion. */
  const setYaw = (yaw: number) => {
    const obj = selected();
    if (!obj) return false;
    return suggest({
      type: "move",
      objectId: obj.id,
      transform: {
        ...obj.transform,
        rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      },
    });
  };
  const remove = () => {
    const o = selected();
    if (o && suggest({ type: "delete", objectId: o.id })) select(null);
  };
  /** Locks are protection, not design changes: applied to the accepted room and draft at once. */
  const toggleLock = () => {
    const o = selected();
    if (!o) return;
    const op: SceneOp = { type: "setLock", objectId: o.id, locked: !o.locked };
    const inAccepted = scene
      .getState()
      .scene.objects.some((a) => a.id === o.id);
    if (inAccepted && !commit(op)) return;
    const current = draft.getState().scene;
    if (current) {
      const r = applyOp(current, op, sceneContext, { allowConflicts: true });
      if (r.ok) draft.setState({ scene: r.scene });
    }
  };
  const travel = (direction: "undo" | "redo") => {
    if (interaction.getState().dragging) return;
    const d = draft.getState();
    if (d.scene || d[direction].length) {
      if (!d[direction].length) return;
      const target = withAcceptedLocks(d[direction].at(-1)!);
      const current = d.scene;
      setDraft(
        target,
        direction === "undo"
          ? { undo: d.undo.slice(0, -1), redo: [...d.redo, current] }
          : { undo: [...d.undo, current], redo: d.redo.slice(0, -1) },
      );
      if (!selected()) select(null);
      return;
    }
    const result = traverseHistory(
      scene.getState().scene,
      history.getState().history,
      direction,
      sceneContext,
    );
    if (!result.ok) {
      notify(result.error.message);
      return;
    }
    if (result.scene === scene.getState().scene) return;
    scene.setState({
      scene: { ...result.scene, updatedAt: new Date().toISOString() },
    });
    if (result.history) history.setState({ history: result.history });
    if (!selected()) select(null);
    autosave?.schedule();
  };
  const chooseAsset = (a: AssetSpec) => {
    const old = selected();
    if (interaction.getState().replacing && old) {
      if (
        suggest({
          type: "replaceAsset",
          objectId: old.id,
          assetId: a.id,
          dimensionsM: a.dimensionsM,
        })
      )
        interaction.setState({ browser: false, replacing: false });
      return;
    }
    const candidate: SceneObject = {
      id: crypto.randomUUID(),
      assetId: a.id,
      category: a.category,
      displayName: a.title,
      dimensionsM: a.dimensionsM,
      locked: false,
      source: "catalog",
      placement: { support: "floor" },
      transform: {
        position: [0, roomShell.floor.elevationY, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    };
    // Search deterministic concentric rings from the center, nearest free location first.
    // First pass checks the piece's full rotation circle (a square as wide as its
    // diagonal) so it isn't wedged against a neighbour and can rotate in place;
    // the second pass falls back to its real footprint in crowded rooms.
    const [w, h, d] = a.dimensionsM;
    const diagonal = Math.hypot(w, d);
    const footprints: Vec3[] = [[diagonal, h, diagonal], a.dimensionsM];
    for (const dimensionsM of footprints)
      for (let ring = 0; ring <= 24; ring++)
        for (let step = 0; step < (ring === 0 ? 1 : ring * 12); step++) {
          const angle = (step / (ring * 12 || 1)) * Math.PI * 2;
          candidate.transform.position = [
            Math.cos(angle) * ring * 0.14,
            roomShell.floor.elevationY,
            Math.sin(angle) * ring * 0.14,
          ];
          if (
            validateOp(
              working(),
              { type: "add", object: { ...candidate, dimensionsM } },
              sceneContext,
            ).ok
          ) {
            if (suggest({ type: "add", object: candidate })) {
              select(candidate.id);
              interaction.setState({ browser: false, replacing: false });
              notify(`${a.title} added.`);
            }
            return;
          }
        }
    notify("No free space for this piece. Move or remove something first.");
  };
  const reset = async () => {
    if (repository?.reset) {
      const wasReady = scene.getState().ready;
      scene.setState({ ready: false });
      interaction.setState({
        selectedId: null,
        dragging: false,
        browser: false,
      });
      autosave?.dispose();
      await autosave?.whenIdle();
      const baseRevision =
        autosave?.acknowledgedRevision() ?? scene.getState().scene.revision;
      try {
        const restored = await repository.reset(createFixtureScene().roomId);
        scene.setState({ scene: restored, ready: true });
        autosave = new Autosave(
          repository,
          () => scene.getState().scene,
          (s) => save.setState(s),
          restored.revision,
        );
        history.setState({ history: createHistory() });
        draft.setState(emptyDraft());
        save.setState({ status: "saved", error: null });
        notify("Room reset to the original arrangement.");
      } catch (error) {
        scene.setState({ ready: wasReady });
        if (wasReady)
          autosave = new Autosave(
            repository,
            () => scene.getState().scene,
            (s) => save.setState(s),
            baseRevision,
          );
        save.setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not reset this room.",
        });
      }
      return;
    }
    const current = scene.getState().scene;
    scene.setState({
      scene: { ...createFixtureScene(), revision: current.revision + 1 },
      ready: true,
    });
    history.setState({ history: createHistory() });
    draft.setState(emptyDraft());
    select(null);
    autosave?.schedule();
    notify("Room reset to the original arrangement.");
  };
  const load = async () => {
    if (!repository) return;
    try {
      const loaded = await repository.load(createFixtureScene().roomId);
      scene.setState({ scene: loaded, ready: true });
      history.setState({ history: createHistory() });
      draft.setState(emptyDraft());
      interaction.setState({ selectedId: null, dragging: false });
      save.setState({ status: "saved", error: null });
      autosave?.dispose();
      autosave = new Autosave(
        repository,
        () => scene.getState().scene,
        (s) => save.setState(s),
        loaded.revision,
      );
    } catch (e) {
      save.setState({
        status: "error",
        error: e instanceof Error ? e.message : "Could not load this room.",
      });
      notify("Could not load the saved room. Use the room menu to reset.");
    }
  };
  return {
    scene,
    interaction,
    history,
    save,
    draft,
    working,
    motion,
    previewMove,
    clearMotion,
    notify,
    commit,
    suggest,
    accept,
    discard,
    revertPiece,
    changes,
    hasDraft: () => draft.getState().scene !== null,
    selected,
    select,
    rotate,
    setYaw,
    remove,
    toggleLock,
    travel,
    chooseAsset,
    reset,
    load,
    retry: () => (autosave ? autosave.retry() : void load()),
    flush: () => autosave?.flush(),
    pending: () => autosave?.isPending() ?? false,
    dispose: () => {
      autosave?.dispose();
      clearTimeout(toastTimer);
    },
  };
}
export type Editor = ReturnType<typeof createEditor>;
export const editor = createEditor(new LocalStorageSceneRepository());
/** The gesture session is mutable and deliberately lives outside all Zustand stores. */
export class DragSession {
  private id: string | null = null;
  private candidate: Transform | null = null;
  constructor(private editor: Editor) {}
  begin(id: string): boolean {
    const o = this.editor.working().objects.find((o) => o.id === id);
    if (!o) return false;
    this.editor.select(id);
    if (o.locked) {
      this.editor.notify(`${o.displayName} is locked. Unlock it first.`);
      return false;
    }
    const valid = validateOp(
      this.editor.working(),
      { type: "move", objectId: id, transform: o.transform },
      sceneContext,
      { allowConflicts: true },
    );
    if (!valid.ok) {
      this.editor.notify(valid.error.message);
      return false;
    }
    this.id = id;
    this.candidate = structuredClone(o.transform);
    this.editor.interaction.setState({ dragging: true });
    return true;
  }
  preview(transform: Transform) {
    if (!this.id) return { ok: true as const };
    this.candidate = transform;
    // Full validation for live feedback only; release never rejects conflicts.
    return validateOp(
      this.editor.working(),
      { type: "move", objectId: this.id, transform },
      sceneContext,
    );
  }
  release(): boolean {
    const id = this.id,
      transform = this.candidate;
    this.cancel();
    if (!id || !transform) return false;
    const original = this.editor
      .working()
      .objects.find((o) => o.id === id)?.transform;
    if (JSON.stringify(original) === JSON.stringify(transform)) return true;
    return this.editor.suggest(
      { type: "move", objectId: id, transform },
      { snap: false },
    );
  }
  cancel() {
    this.editor.clearMotion();
    this.id = null;
    this.candidate = null;
    this.editor.interaction.setState({ dragging: false });
  }
}
