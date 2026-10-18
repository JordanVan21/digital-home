import { createStore } from "zustand/vanilla";
import {
  assetById,
  livingRoom,
  type AssetSpec,
  type RoomDefinition,
  type RoomShell,
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
  onNearestSurface,
  traverseHistory,
  validateObject,
  validateOp,
  yawOf,
  worldYaw,
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
import { roomById } from "./rooms";
export type CameraView = "iso" | "top" | "eye" | "selection" | "room" | "photo";
export type Tool = "select" | "move" | "rotate";
export type Interaction = {
  cameraView: CameraView;
  cameraRequest: number;
  walk: boolean;
  wallMode: "cutaway" | "fade" | "show";
  selectedId: string | null;
  selectedIds: string[];
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
export type ChangeKind =
  | "updated"
  | "moved"
  | "rotated"
  | "replaced"
  | "added"
  | "removed";
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
function conflictsOf(
  accepted: SceneSpec,
  draft: SceneSpec | null,
  sceneContext: SceneContext,
) {
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
export const contextFor = (room: RoomDefinition): SceneContext => ({
  room: room.shell,
  assets: assetById,
  roomId: room.roomId,
});
/** Middle of the floor's bounds, where new pieces start their free-space search. */
function floorCenter(shell: RoomShell): [number, number] {
  const xs = shell.floor.polygonXZ.map((p) => p[0]),
    zs = shell.floor.polygonXZ.map((p) => p[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  ];
}
export function createEditor(
  repository?: SceneRepository,
  initialRoom: RoomDefinition = livingRoom,
) {
  const room = createStore<{ room: RoomDefinition }>(() => ({
    room: initialRoom,
  }));
  let sceneContext = contextFor(initialRoom);
  const context = () => sceneContext;
  const scene = createStore<{ scene: SceneSpec; ready: boolean }>(() => ({
    scene: initialRoom.createScene(),
    ready: !repository,
  }));
  const interaction = createStore<Interaction>(() => ({
    cameraView: "iso",
    cameraRequest: 0,
    walk: false,
    selectedId: null,
    selectedIds: [],
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
    wallMode: "cutaway",
  }));
  const history = createStore<{ history: History }>(() => ({
    history: createHistory(),
  }));
  const save = createStore<SaveState>(() => ({ status: "saved", error: null }));
  const draft = createStore<Draft>(emptyDraft);
  /** The scene the user sees and edits: the draft if any, else the accepted room. */
  const working = () => draft.getState().scene ?? scene.getState().scene;
  // Transient transforms are read by the frame loop; pointer moves never notify React.
  const motion = {
    transforms: new Map<string, Transform>(),
    wallVisibility: new Map<string, number>(),
    perf: { frames: 0, lastFrameAt: 0, fps: 0, drawCalls: 0, triangles: 0 },
    cameraPosition: [7.2, 6.5, 8.3] as Vec3,
    cameraDirection: [0, 0, -1] as Vec3,
    cameraTarget: [0, 0.65, 0] as Vec3,
    pointerHandled: false,
    projectPoint: undefined as undefined | ((point: Vec3) => [number, number]),
  };
  const clearMotion = () => motion.transforms.clear();
  const selectionMoves = (id: string, transform: Transform): SceneOp[] => {
    const before = working();
    const root = before.objects.find((o) => o.id === id);
    if (!root) return [];
    const selection = interaction.getState().selectedIds;
    const ids =
      selection.includes(id) && selection.length > 1 ? selection : [id];
    const descendants = new Set(
      ids.flatMap((key) => [...supportedDescendants(before, key)]),
    );
    return ids
      .filter((key) => !descendants.has(key))
      .flatMap((key) => {
        const obj = before.objects.find((o) => o.id === key);
        if (!obj) return [];
        return [
          {
            type: "move" as const,
            objectId: key,
            transform: {
              ...obj.transform,
              position:
                key === id
                  ? transform.position
                  : (obj.transform.position.map(
                      (v, i) =>
                        v +
                        (transform.position[i] - root.transform.position[i]),
                    ) as Vec3),
              ...(key === id
                ? { rotation: transform.rotation, scale: transform.scale }
                : {}),
            },
          },
        ];
      });
  };
  const previewMove = (id: string, transform: Transform) => {
    const before = working();
    let moved = before;
    for (const op of selectionMoves(id, transform))
      if (op.type === "move")
        moved = moveAssembly(moved, op.objectId, op.transform);
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
      !d ||
      (!d.changed.length &&
        !d.added.length &&
        !d.removed.length &&
        !d.appearanceChanged);
    const value = empty ? null : next;
    draft.setState({
      scene: value,
      ...stacks,
      conflicts: conflictsOf(accepted, value, sceneContext),
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
  /** Atomic UI batch: singular contract operations never depend on selection. */
  const suggestMany = (operations: SceneOp[]): boolean => {
    if (!scene.getState().ready || !operations.length) return false;
    const previous = draft.getState().scene;
    let next = working();
    for (const op of operations) {
      const result = applyOp(next, op, sceneContext, { allowConflicts: true });
      if (!result.ok) {
        notify(result.error.message);
        return false;
      }
      next = result.scene;
    }
    setDraft(next, {
      undo: [...draft.getState().undo, previous].slice(-80),
      redo: [],
    });
    return true;
  };
  const moveSelection = (id: string, transform: Transform) =>
    suggestMany(selectionMoves(id, transform));
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
    if (id === current.roomId) {
      setDraft(
        { ...current, appearance: scene.getState().scene.appearance },
        { undo: [...draft.getState().undo, current], redo: [] },
      );
      return;
    }
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
    if (d.appearanceChanged)
      rows.push({
        id: proposed.roomId,
        kind: "updated",
        name: "Room finishes",
      });
    for (const o of proposed.objects) {
      const prev = before.get(o.id);
      if (!prev) {
        rows.push({ id: o.id, kind: "added", name: o.displayName });
      } else if (d.changed.includes(o.id)) {
        const [x0, y0, z0] = prev.transform.position;
        const [x1, y1, z1] = o.transform.position;
        const distanceM = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const degrees = degreesBetween(prev, o);
        const kind: ChangeKind =
          prev.assetId !== o.assetId
            ? "replaced"
            : JSON.stringify(prev.transform) === JSON.stringify(o.transform)
              ? "updated"
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
  const requestView = (view: CameraView): boolean => {
    if (interaction.getState().dragging || !scene.getState().ready)
      return false;
    if (view === "selection" && !selected()) {
      notify("Select a piece to frame.");
      return false;
    }
    interaction.setState((s) => ({
      cameraView: view,
      cameraRequest: s.cameraRequest + 1,
      planView:
        view === "top" ||
        ((view === "room" || view === "selection") && s.planView),
      walk: false,
    }));
    return true;
  };
  const setWalk = (walk: boolean): boolean => {
    if (interaction.getState().dragging || !scene.getState().ready)
      return false;
    interaction.setState((s) => ({
      walk,
      planView: walk ? false : s.planView,
    }));
    return true;
  };
  const selectMany = (
    ids: string[],
    options: { individual?: boolean } = {},
  ) => {
    const primary = ids.at(-1);
    if (!options.individual) {
      const groups = new Set(
        working()
          .objects.filter((o) => ids.includes(o.id) && o.groupId)
          .map((o) => o.groupId),
      );
      ids = [
        ...ids,
        ...working()
          .objects.filter((o) => o.groupId && groups.has(o.groupId))
          .map((o) => o.id),
      ];
    }
    const available = new Set(working().objects.map((o) => o.id));
    const selectedIds = [...new Set(ids)].filter((id) => available.has(id));
    interaction.setState({
      selectedIds,
      selectedId:
        primary && selectedIds.includes(primary)
          ? primary
          : (selectedIds.at(-1) ?? null),
    });
  };
  const select = (id: string | null) => selectMany(id ? [id] : []);
  const toggleSelection = (id: string) => {
    const ids = interaction.getState().selectedIds;
    const group = working().objects.find((o) => o.id === id)?.groupId;
    const members = group
      ? working()
          .objects.filter((o) => o.groupId === group)
          .map((o) => o.id)
      : [id];
    selectMany(
      ids.includes(id)
        ? ids.filter((key) => !members.includes(key))
        : [...ids, ...members],
    );
  };
  const groupSelection = (ungroup = false) => {
    if (interaction.getState().dragging) return false;
    const ids = interaction.getState().selectedIds;
    const groups = new Set(
      working()
        .objects.filter((o) => ids.includes(o.id) && o.groupId)
        .map((o) => o.groupId),
    );
    const members = ungroup
      ? working()
          .objects.filter((o) => o.groupId && groups.has(o.groupId))
          .map((o) => o.id)
      : ids;
    if ((!ungroup && members.length < 2) || !members.length) return false;
    const groupId = ungroup ? undefined : crypto.randomUUID();
    return suggestMany(
      members.map((objectId) => ({ type: "setGroup", objectId, groupId })),
    );
  };
  const nudge = (forward: number, right: number, factor = 1) => {
    const obj = selected();
    if (!obj || interaction.getState().dragging || !scene.getState().ready)
      return false;
    const [x, , z] = motion.cameraDirection,
      length = Math.hypot(x, z);
    const fx = length > 0.001 ? x / length : 0,
      fz = length > 0.001 ? z / length : -1;
    const [px, py, pz] = obj.transform.position,
      stride = 0.02 * factor;
    return moveSelection(obj.id, {
      ...obj.transform,
      position: [
        px + stride * (fx * forward - fz * right),
        py,
        pz + stride * (fz * forward + fx * right),
      ],
    });
  };
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
        rotation: worldYaw(
          obj.transform.rotation,
          yaw - yawOf(obj.transform.rotation),
        ),
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
  const duplicate = (): boolean => {
    const original = selected();
    if (!original || interaction.getState().dragging || !scene.getState().ready)
      return false;
    if (original.locked) {
      notify("Unlock this piece to duplicate it.");
      return false;
    }
    const current = working(),
      copy = structuredClone(original);
    copy.id = crypto.randomUUID();
    copy.locked = false;
    copy.source = "user";
    copy.ownership = "planned_new";
    delete copy.replacesObjectId;
    delete copy.scanMatch;
    delete copy.groupId;
    delete copy.renovationDecision;
    const base = original.displayName.replace(/ copy(?: \d+)?$/, "");
    let name = `${base} copy`,
      suffix = 2;
    while (current.objects.some((o) => o.displayName === name))
      name = `${base} copy ${suffix++}`;
    copy.displayName = name;
    const wall =
      copy.placement?.support === "wall"
        ? sceneContext.room.walls.find((w) => w.id === copy.placement?.parentId)
        : undefined;
    const dx = wall ? wall.toXZ[0] - wall.fromXZ[0] : 0,
      dz = wall ? wall.toXZ[1] - wall.fromXZ[1] : 0,
      len = Math.hypot(dx, dz) || 1;
    for (let ring = 1; ring <= 24; ring++)
      for (let step = 0; step < (wall ? 2 : ring * 12); step++) {
        const angle = (step / (ring * 12)) * Math.PI * 2,
          radius = wall
            ? ring * (copy.dimensionsM[0] * copy.transform.scale[0] + 0.03)
            : ring * 0.14;
        const x = wall
            ? (dx / len) * radius * (step ? -1 : 1)
            : Math.cos(angle) * radius,
          z = wall
            ? (dz / len) * radius * (step ? -1 : 1)
            : Math.sin(angle) * radius;
        const candidate = onNearestSurface(
          current,
          {
            ...copy,
            transform: {
              ...copy.transform,
              position: [
                original.transform.position[0] + x,
                original.transform.position[1],
                original.transform.position[2] + z,
              ],
            },
          },
          sceneContext.room,
          sceneContext.assets,
        );
        if (
          !validateOp(current, { type: "add", object: candidate }, sceneContext)
            .ok
        )
          continue;
        if (suggest({ type: "add", object: candidate })) {
          select(copy.id);
          notify(`${copy.displayName} added.`);
          return true;
        }
      }
    notify("No free space nearby for a copy.");
    return false;
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
        position: [0, sceneContext.room.floor.elevationY, 0],
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
    const [cx, cz] = floorCenter(sceneContext.room);
    for (const dimensionsM of footprints)
      for (let ring = 0; ring <= 24; ring++)
        for (let step = 0; step < (ring === 0 ? 1 : ring * 12); step++) {
          const angle = (step / (ring * 12 || 1)) * Math.PI * 2;
          candidate.transform.position = [
            cx + Math.cos(angle) * ring * 0.14,
            sceneContext.room.floor.elevationY,
            cz + Math.sin(angle) * ring * 0.14,
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
        selectedIds: [],
        dragging: false,
        browser: false,
      });
      autosave?.dispose();
      await autosave?.whenIdle();
      const baseRevision =
        autosave?.acknowledgedRevision() ?? scene.getState().scene.revision;
      try {
        const restored = await repository.reset(room.getState().room.roomId);
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
      scene: {
        ...room.getState().room.createScene(),
        revision: current.revision + 1,
      },
      ready: true,
    });
    history.setState({ history: createHistory() });
    draft.setState(emptyDraft());
    select(null);
    autosave?.schedule();
    notify("Room reset to the original arrangement.");
  };
  /** Points the editor at another room; the caller loads its scene. */
  const enterRoom = (next: RoomDefinition) => {
    room.setState({ room: next });
    sceneContext = contextFor(next);
    scene.setState({ scene: next.createScene(), ready: !repository });
    history.setState({ history: createHistory() });
    draft.setState(emptyDraft());
    interaction.setState({
      cameraView: "iso",
      walk: false,
      planView: false,
      selectedId: null,
      selectedIds: [],
      hoveredId: null,
      dragging: false,
      browser: false,
      replacing: false,
    });
  };
  /**
   * Opens another room. Suggestions must be accepted or discarded first, and
   * the current room's pending save completes before leaving it.
   */
  const switchRoom = async (roomId: string): Promise<boolean> => {
    const next = roomById(roomId);
    if (!next || interaction.getState().dragging) return false;
    if (next === room.getState().room) return true;
    if (draft.getState().scene) {
      notify("Accept or discard your suggestions before switching rooms.");
      return false;
    }
    if (autosave) {
      await autosave.whenIdle();
      await autosave.flush();
      if (autosave.isPending()) {
        notify("This room hasn't saved yet. Retry the save, then switch.");
        return false;
      }
      autosave.dispose();
      autosave = undefined;
    }
    enterRoom(next);
    await load();
    return true;
  };
  const load = async (roomId?: string) => {
    if (roomId && roomId !== room.getState().room.roomId) {
      const next = roomById(roomId);
      if (next) enterRoom(next);
    }
    if (!repository) return;
    try {
      const loaded = await repository.load(room.getState().room.roomId);
      scene.setState({ scene: loaded, ready: true });
      history.setState({ history: createHistory() });
      draft.setState(emptyDraft());
      interaction.setState({
        selectedId: null,
        selectedIds: [],
        dragging: false,
      });
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
    room,
    context,
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
    selectMany,
    toggleSelection,
    groupSelection,
    suggestMany,
    moveSelection,
    selectionMoves,
    requestView,
    setWalk,
    rotate,
    setYaw,
    nudge,
    remove,
    toggleLock,
    travel,
    chooseAsset,
    duplicate,
    reset,
    load,
    switchRoom,
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
    if (!this.editor.interaction.getState().selectedIds.includes(id))
      this.editor.select(id);
    if (o.locked) {
      this.editor.notify(`${o.displayName} is locked. Unlock it first.`);
      return false;
    }
    for (const op of this.editor.selectionMoves(id, o.transform)) {
      const valid = validateOp(
        this.editor.working(),
        op,
        this.editor.context(),
        { allowConflicts: true },
      );
      if (!valid.ok) {
        this.editor.notify(valid.error.message);
        return false;
      }
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
      this.editor.context(),
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
    return this.editor.moveSelection(id, transform);
  }
  cancel() {
    this.editor.clearMotion();
    this.id = null;
    this.candidate = null;
    this.editor.interaction.setState({ dragging: false });
  }
}
