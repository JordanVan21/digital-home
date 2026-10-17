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
  createHistory,
  record,
  traverseHistory,
  validateOp,
  yawOf,
  type History,
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
};
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
    browser: false,
    replacing: false,
    inspector: true,
    resetView: 0,
    toast: null,
    lighting: null,
    planView: false,
    measurements: false,
  }));
  const history = createStore<{ history: History }>(() => ({
    history: createHistory(),
  }));
  const save = createStore<SaveState>(() => ({ status: "saved", error: null }));
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
  const selected = () =>
    scene
      .getState()
      .scene.objects.find((o) => o.id === interaction.getState().selectedId);
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
    commit({
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
    if (o && commit({ type: "delete", objectId: o.id })) select(null);
  };
  const toggleLock = () => {
    const o = selected();
    if (o) commit({ type: "setLock", objectId: o.id, locked: !o.locked });
  };
  const travel = (direction: "undo" | "redo") => {
    if (interaction.getState().dragging) return;
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
        commit({
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
              scene.getState().scene,
              { type: "add", object: { ...candidate, dimensionsM } },
              sceneContext,
            ).ok
          ) {
            if (commit({ type: "add", object: candidate })) {
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
    notify,
    commit,
    selected,
    select,
    rotate,
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
    const o = this.editor.scene
      .getState()
      .scene.objects.find((o) => o.id === id);
    if (!o) return false;
    this.editor.select(id);
    if (o.locked) {
      this.editor.notify(`${o.displayName} is locked. Unlock it first.`);
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
    return validateOp(
      this.editor.scene.getState().scene,
      { type: "move", objectId: this.id, transform },
      sceneContext,
    );
  }
  release(): boolean {
    const id = this.id,
      transform = this.candidate;
    this.cancel();
    if (!id || !transform) return false;
    const original = this.editor.scene
      .getState()
      .scene.objects.find((o) => o.id === id)?.transform;
    if (JSON.stringify(original) === JSON.stringify(transform)) return true;
    return this.editor.commit({ type: "move", objectId: id, transform });
  }
  cancel() {
    this.id = null;
    this.candidate = null;
    this.editor.interaction.setState({ dragging: false });
  }
}
