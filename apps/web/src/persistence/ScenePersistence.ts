import type { SaveScenePatchRequest, SaveScenePatchResult, SceneSpec } from '@house/contracts';
import { applyOps } from '@house/scene-engine';
import type { RoomShell } from '@house/contracts';

/**
 * Scene persistence port (CONTRACTS §5 `getScene` / `saveScenePatch`). The mock below stands in
 * for the authenticated API; a Supabase/Node adapter implements the same interface later.
 */
export interface ScenePersistence {
  /** Latest working scene for a room, or null if none has been saved. */
  getScene(roomId: string): Promise<SceneSpec | null>;
  /** Create the room's scene if absent (import step stand-in). Returns the stored scene. */
  ensureScene(scene: SceneSpec, shell: RoomShell): Promise<SceneSpec>;
  /** Revision-checked, idempotent (per idempotencyKey) patch save. */
  saveScenePatch(req: SaveScenePatchRequest): Promise<SaveScenePatchResult>;
}

type StoredRoom = { scene: SceneSpec; shell: RoomShell; processed: Record<string, SaveScenePatchResult> };

/** Minimal Storage surface (localStorage-compatible) so tests can inject an in-memory map. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function safeStorage(): KeyValueStorage {
  try {
    const s = globalThis.localStorage;
    const probe = '__house_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/**
 * Mock backend: in-memory + localStorage (all storage access guarded). Validates every patch with
 * the shared scene-engine reducer, enforces revision CAS, and dedupes retries by idempotency key.
 * Dev hooks simulate failures and concurrent edits.
 */
export class LocalScenePersistence implements ScenePersistence {
  private readonly rooms = new Map<string, StoredRoom>();
  private failures = 0;

  constructor(
    private readonly storage: KeyValueStorage = safeStorage(),
    private readonly latencyMs = 150,
    private readonly prefix = 'house.scene.',
  ) {}

  /** `fresh` re-reads storage, so saves made by another tab are seen (two-tab safety, from codex). */
  private read(roomId: string, fresh = false): StoredRoom | null {
    const cached = this.rooms.get(roomId);
    if (cached && !fresh) return cached;
    try {
      const raw = this.storage.getItem(this.prefix + roomId);
      if (!raw) return cached ?? null;
      const room = JSON.parse(raw) as StoredRoom;
      this.rooms.set(roomId, room);
      return room;
    } catch {
      return cached ?? null;
    }
  }

  /**
   * Run a read-check-write under a per-room Web Lock (from the codex sandbox), so two tabs saving at
   * once are serialized and the revision check sees the other tab's save. Without Web Locks (tests,
   * old browsers) it runs directly; sequential stale writes are still rejected by the fresh read.
   */
  private locked<T>(roomId: string, f: () => T): Promise<T> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? (locks.request(`${this.prefix}${roomId}`, () => f()) as Promise<T>) : Promise.resolve(f());
  }

  private write(roomId: string, room: StoredRoom) {
    this.rooms.set(roomId, room);
    try {
      this.storage.setItem(this.prefix + roomId, JSON.stringify(room));
    } catch {
      // Quota/private mode: keep the in-memory copy; the UI still shows saved for this session.
    }
  }

  private delay() {
    return new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async getScene(roomId: string) {
    await this.delay();
    return structuredClone(this.read(roomId, true)?.scene ?? null);
  }

  async ensureScene(scene: SceneSpec, shell: RoomShell) {
    const existing = this.read(scene.roomId);
    if (existing && existing.scene.shellId === scene.shellId) return structuredClone(existing.scene);
    this.write(scene.roomId, { scene, shell, processed: {} });
    return structuredClone(scene);
  }

  async saveScenePatch(req: SaveScenePatchRequest): Promise<SaveScenePatchResult> {
    await this.delay();
    if (this.failures > 0) {
      this.failures--;
      throw new Error('Network error (simulated)');
    }
    return this.locked(req.roomId, () => this.applyPatch(req));
  }

  private applyPatch(req: SaveScenePatchRequest): SaveScenePatchResult {
    const room = this.read(req.roomId, true);
    if (!room) return { ok: false, code: 'NOT_FOUND', message: 'Room not found.' };
    const prior = room.processed[req.idempotencyKey];
    if (prior) return structuredClone(prior);
    if (req.baseRevision !== room.scene.revision) {
      return { ok: false, code: 'CONFLICT', currentRevision: room.scene.revision };
    }
    const r = applyOps({ shell: room.shell, geometry: 'report' }, room.scene, req.operations);
    if (!r.ok) return { ok: false, code: 'VALIDATION_ERROR', message: `${r.error.reason}: ${r.error.message}` };
    const scene: SceneSpec = { ...r.scene, revision: room.scene.revision + 1, updatedAt: new Date().toISOString() };
    const result: SaveScenePatchResult = { ok: true, revision: scene.revision, scene };
    // Keep a bounded idempotency window.
    const keys = Object.keys(room.processed);
    const processed = Object.fromEntries(keys.slice(-50).map((k) => [k, room.processed[k]!]));
    processed[req.idempotencyKey] = { ok: true, revision: scene.revision, scene };
    this.write(req.roomId, { ...room, scene, processed });
    return structuredClone(result);
  }

  // ---------------------------------------------------------------- dev simulation hooks
  /** Make the next `n` saves throw (network failure). */
  failNext(n = 1) {
    this.failures = n;
  }

  /** Simulate another session saving first: bumps the stored revision. */
  simulateExternalEdit(roomId: string) {
    const room = this.read(roomId);
    if (!room) return;
    this.write(roomId, { ...room, scene: { ...room.scene, revision: room.scene.revision + 1, updatedAt: new Date().toISOString() } });
  }

  reset(roomId: string) {
    this.rooms.delete(roomId);
    try {
      this.storage.removeItem(this.prefix + roomId);
    } catch {
      /* ignore */
    }
  }
}
