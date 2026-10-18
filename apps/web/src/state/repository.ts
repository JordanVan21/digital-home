import {
  applyOp,
  diffToOps,
  stableStringify,
  validateObject,
  type SceneContext,
} from "@house/scene-engine";
import {
  SceneSpecSchema,
  SceneOpSchema,
  assetById,
  type SceneOp,
  type RoomDefinition,
  type SceneSpec,
} from "@house/contracts";
import { roomById } from "./rooms";
import {
  cloudRoomIds,
  fetchCloudScene,
  pushCloudScene,
  settleCloudScene,
} from "./cloud";
export interface SceneRepository {
  load(roomId: string): Promise<SceneSpec>;
  save(scene: SceneSpec, baseRevision: number): Promise<{ revision: number }>;
  saveScenePatch?(
    roomId: string,
    baseRevision: number,
    idempotencyKey: string,
    operations: SceneOp[],
  ): Promise<{ revision: number }>;
  patchContext?(roomId: string): SceneContext;
  /** Explicit recovery for unreadable local data, only triggered by Reset room. */
  reset?(roomId: string): Promise<SceneSpec>;
}
export class RepositoryError extends Error {
  constructor(
    public code: "CONFLICT" | "STORAGE_UNAVAILABLE" | "CORRUPT_DATA",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
type StoragePort = Pick<Storage, "getItem" | "setItem">;
export class LocalStorageSceneRepository implements SceneRepository {
  private failNext = false;
  simulateSaveFailure() {
    this.failNext = true;
  }
  simulateExternalEdit(roomId: string) {
    return this.exclusive(roomId, () => {
      const current = this.read(roomId);
      this.write({ ...current, revision: current.revision + 1 });
    });
  }
  // Resolve browser storage lazily: disabled storage must produce an editor error, not an import-time crash.
  constructor(
    private providedStorage?: StoragePort,
    private rooms: (roomId: string) => RoomDefinition | undefined = roomById,
  ) {}
  private get storage(): StoragePort {
    return this.providedStorage ?? window.localStorage;
  }
  private key(id: string) {
    return `house.scene.v1.${id}`;
  }
  private room(roomId: string): RoomDefinition {
    const room = this.rooms(roomId);
    if (!room)
      throw new RepositoryError("CORRUPT_DATA", "This room is unavailable.");
    return room;
  }
  private read(roomId: string): SceneSpec {
    const room = this.room(roomId);
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key(roomId));
    } catch {
      throw new RepositoryError(
        "STORAGE_UNAVAILABLE",
        "Local storage is unavailable.",
      );
    }
    if (!raw) return room.createScene();
    try {
      const scene = SceneSpecSchema.parse(JSON.parse(raw));
      const fixture = room.createScene();
      if (
        scene.roomId !== roomId ||
        scene.shellId !== fixture.shellId ||
        scene.id !== fixture.id
      )
        throw new Error("Wrong room");
      return scene;
    } catch {
      throw new RepositoryError(
        "CORRUPT_DATA",
        "The saved room could not be read. Reset the room to start again.",
      );
    }
  }
  async load(roomId: string): Promise<SceneSpec> {
    return this.read(roomId);
  }
  protected write(scene: SceneSpec, receipts?: unknown[]) {
    try {
      this.storage.setItem(
        this.key(scene.roomId),
        JSON.stringify({
          ...scene,
          updatedAt: new Date().toISOString(),
          ...(receipts ? { _housePatches: receipts } : {}),
        }),
      );
    } catch {
      throw new RepositoryError(
        "STORAGE_UNAVAILABLE",
        "Could not save on this device. Check available storage and retry.",
      );
    }
  }
  private exclusive<T>(roomId: string, work: () => T): Promise<T> {
    // Web Locks coordinates same-origin tabs on localhost/HTTPS. The synchronous fallback still checks for stale saves.
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(`house.scene.${roomId}`, work);
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error);
    }
  }
  save(scene: SceneSpec, baseRevision: number): Promise<{ revision: number }> {
    return this.exclusive(scene.roomId, () => {
      if (this.failNext) {
        this.failNext = false;
        throw new RepositoryError(
          "STORAGE_UNAVAILABLE",
          "Simulated save failure. Retry to save your changes.",
        );
      }
      SceneSpecSchema.parse(scene);
      const existing = this.read(scene.roomId);
      if (existing.revision !== baseRevision || scene.revision < baseRevision)
        throw new RepositoryError(
          "CONFLICT",
          "This room changed in another tab. Reload to see the saved room.",
        );
      this.write(scene);
      return { revision: scene.revision };
    });
  }
  patchContext(roomId: string): SceneContext {
    return { room: this.room(roomId).shell, assets: assetById, roomId };
  }
  saveScenePatch(
    roomId: string,
    baseRevision: number,
    idempotencyKey: string,
    operations: SceneOp[],
  ): Promise<{ revision: number }> {
    return this.exclusive(roomId, () => {
      if (this.failNext) {
        this.failNext = false;
        throw new RepositoryError(
          "STORAGE_UNAVAILABLE",
          "Simulated save failure. Retry to save your changes.",
        );
      }
      const parsed = operations.map((op) => SceneOpSchema.parse(op));
      const payload = stableStringify({ baseRevision, operations: parsed });
      const raw = this.storage.getItem(this.key(roomId));
      const receipts: { key: string; payload: string; revision: number }[] = raw
        ? (JSON.parse(raw)._housePatches ?? [])
        : [];
      const previous = receipts.find((r) => r.key === idempotencyKey);
      if (previous) {
        if (previous.payload !== payload)
          throw new RepositoryError(
            "CONFLICT",
            "This retry key belongs to a different patch.",
          );
        return { revision: previous.revision };
      }
      const before = this.read(roomId);
      if (before.revision !== baseRevision)
        throw new RepositoryError(
          "CONFLICT",
          "This room changed in another session. Reload the saved room before editing again.",
        );
      let next = before;
      const ctx = this.patchContext(roomId);
      for (const op of parsed) {
        const result = applyOp(next, op, ctx, { allowConflicts: true });
        if (!result.ok)
          throw new RepositoryError("CORRUPT_DATA", result.error.message);
        next = result.scene;
      }
      for (const object of next.objects) {
        const validation = validateObject(next, object, ctx);
        if (!validation.ok)
          throw new RepositoryError("CORRUPT_DATA", validation.error.message);
      }
      const revision = baseRevision + 1;
      this.write(
        { ...next, revision },
        [...receipts, { key: idempotencyKey, payload, revision }].slice(-80),
      );
      return { revision };
    });
  }
  reset(roomId: string): Promise<SceneSpec> {
    return this.exclusive(roomId, () => {
      let revision = 0;
      try {
        revision = this.read(roomId).revision + 1;
      } catch (error) {
        if (
          !(error instanceof RepositoryError) ||
          error.code !== "CORRUPT_DATA"
        )
          throw error;
      }
      const next = { ...this.room(roomId).createScene(), revision };
      this.write(next);
      return next;
    });
  }
}
export type SaveState = {
  status: "saved" | "saving" | "error" | "conflict";
  error: string | null;
};
/** One debounced queue, one in-flight save, and one acknowledged storage revision. */
export class Autosave {
  onAcknowledged?: (snapshot: SceneSpec, revision: number) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private inFlight = false;
  private disposed = false;
  private baseRevision: number;
  private lastEdit = 0;
  private acknowledgedScene: SceneSpec;
  private attempt:
    | { snapshot: SceneSpec; key: string; ops: SceneOp[] }
    | undefined;
  private idleWaiters: (() => void)[] = [];
  constructor(
    private repository: SceneRepository,
    private read: () => SceneSpec,
    private status: (s: SaveState) => void,
    revision: number,
    private delay = 500,
  ) {
    this.baseRevision = revision;
    this.acknowledgedScene = structuredClone(this.read());
  }
  schedule = () => {
    this.pending = true;
    this.lastEdit = Date.now();
    this.status({ status: "saving", error: null });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  };
  retry = () => {
    this.pending = true;
    this.status({ status: "saving", error: null });
    void this.flush();
  };
  flush = async () => {
    if (this.disposed || this.inFlight || !this.pending) return;
    clearTimeout(this.timer);
    this.pending = false;
    this.inFlight = true;
    const snapshot = this.attempt?.snapshot ?? this.read();
    try {
      let result: { revision: number };
      if (this.repository.saveScenePatch) {
        if (!this.attempt) {
          const room = roomById(snapshot.roomId);
          const ctx =
            this.repository.patchContext?.(snapshot.roomId) ??
            (room
              ? { room: room.shell, assets: assetById, roomId: snapshot.roomId }
              : undefined);
          if (!ctx) throw new Error("Unknown room for patch saving.");
          const patch = diffToOps(this.acknowledgedScene, snapshot, ctx);
          if (!patch.ok) throw new Error(patch.message);
          this.attempt = {
            snapshot: structuredClone(snapshot),
            key: crypto.randomUUID(),
            ops: patch.ops,
          };
        }
        result = await this.repository.saveScenePatch(
          snapshot.roomId,
          this.baseRevision,
          this.attempt.key,
          this.attempt.ops,
        );
      } else result = await this.repository.save(snapshot, this.baseRevision);
      this.acknowledgedScene = {
        ...structuredClone(snapshot),
        revision: result.revision,
      };
      this.attempt = undefined;
      this.baseRevision = result.revision;
      if (this.read().revision !== snapshot.revision) this.pending = true;
      if (!this.disposed) this.onAcknowledged?.(snapshot, result.revision);
      if (!this.disposed)
        this.status({ status: this.pending ? "saving" : "saved", error: null });
    } catch (error) {
      this.pending = true;
      clearTimeout(this.timer);
      if (!this.disposed)
        this.status({
          status:
            error instanceof RepositoryError && error.code === "CONFLICT"
              ? "conflict"
              : "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not save this room.",
        });
      return;
    } finally {
      this.inFlight = false;
      this.idleWaiters.splice(0).forEach((done) => done());
    }
    if (this.pending && !this.disposed)
      this.timer = setTimeout(
        () => void this.flush(),
        Math.max(0, this.delay - (Date.now() - this.lastEdit)),
      );
  };
  acknowledgedRevision = () => this.baseRevision;
  whenIdle = (): Promise<void> =>
    this.inFlight
      ? new Promise((resolve) => this.idleWaiters.push(resolve))
      : Promise.resolve();
  isPending = () => this.pending || this.inFlight;
  dispose = () => {
    this.disposed = true;
    clearTimeout(this.timer);
  };
}

/**
 * Local-first repository for scanned rooms stored in Supabase: opening a room
 * adopts the saved copy when it is newer (e.g. the render agent swapped in a better
 * model) or from a different import; every local save is pushed back.
 */
export class CloudSceneRepository extends LocalStorageSceneRepository {
  async load(roomId: string): Promise<SceneSpec> {
    if (cloudRoomIds.has(roomId)) {
      const remote = await fetchCloudScene(roomId).catch(() => null);
      if (remote) {
        const local = await super.load(roomId).catch(() => null);
        if (
          !local ||
          local.revision < remote.revision ||
          local.id !== remote.id ||
          local.shellId !== remote.shellId
        )
          this.write(settleCloudScene(remote));
      }
    }
    return super.load(roomId);
  }
  async save(scene: SceneSpec, baseRevision: number) {
    const result = await super.save(scene, baseRevision);
    this.push(scene.roomId);
    return result;
  }
  async saveScenePatch(
    roomId: string,
    baseRevision: number,
    idempotencyKey: string,
    operations: SceneOp[],
  ) {
    const result = await super.saveScenePatch(
      roomId,
      baseRevision,
      idempotencyKey,
      operations,
    );
    this.push(roomId);
    return result;
  }
  private push(roomId: string) {
    if (!cloudRoomIds.has(roomId)) return;
    void super
      .load(roomId)
      .then(pushCloudScene)
      .catch(() => {});
  }
}
