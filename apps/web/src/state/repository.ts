import {
  SceneSpecSchema,
  type RoomDefinition,
  type SceneSpec,
} from "@house/contracts";
import { roomById } from "./rooms";
export interface SceneRepository {
  load(roomId: string): Promise<SceneSpec>;
  save(scene: SceneSpec, baseRevision: number): Promise<{ revision: number }>;
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
  simulateSaveFailure(){this.failNext=true;}
  simulateExternalEdit(roomId:string){return this.exclusive(roomId,()=>{const current=this.read(roomId);this.write({...current,revision:current.revision+1});});}
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
  private write(scene: SceneSpec) {
    try {
      this.storage.setItem(
        this.key(scene.roomId),
        JSON.stringify({ ...scene, updatedAt: new Date().toISOString() }),
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
      if(this.failNext){this.failNext=false;throw new RepositoryError("STORAGE_UNAVAILABLE","Simulated save failure. Retry to save your changes.");}
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
  status: "saved" | "saving" | "error";
  error: string | null;
};
/** One debounced queue, one in-flight save, and one acknowledged storage revision. */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private inFlight = false;
  private disposed = false;
  private baseRevision: number;
  private lastEdit = 0;
  private idleWaiters: (() => void)[] = [];
  constructor(
    private repository: SceneRepository,
    private read: () => SceneSpec,
    private status: (s: SaveState) => void,
    revision: number,
    private delay = 500,
  ) {
    this.baseRevision = revision;
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
    const snapshot = this.read();
    try {
      const result = await this.repository.save(snapshot, this.baseRevision);
      this.baseRevision = result.revision;
      if (this.read().revision !== snapshot.revision) this.pending = true;
      if (!this.disposed)
        this.status({ status: this.pending ? "saving" : "saved", error: null });
    } catch (error) {
      this.pending = true;
      clearTimeout(this.timer);
      if (!this.disposed)
        this.status({
          status: "error",
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
