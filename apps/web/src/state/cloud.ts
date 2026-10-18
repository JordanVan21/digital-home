import { createClient } from "@supabase/supabase-js";
import { createStore } from "zustand/vanilla";
import {
  AssetSpecSchema,
  RoomShellSchema,
  SceneSpecSchema,
  assetById,
  catalog,
  type RoomDefinition,
  type RoomShell,
  type SceneSpec,
} from "@house/contracts";
import {
  onNearestSurface,
  resolveDraft,
  validateObject,
  type SceneContext,
} from "@house/scene-engine";
import { rooms } from "./rooms";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloudConfig";

/**
 * Supabase link: the shared asset library, the signed-in user's scanned rooms
 * (written by the scan worker) and saving edits back to them. The session is
 * the same email/password account as the iPhone app.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const glbBase = `${SUPABASE_URL}/storage/v1/object/public/glbs/`;

/** Rooms that sync with Supabase (everything else stays local fixtures). */
export const cloudRoomIds = new Set<string>();

/**
 * Adds library assets the bundled catalog lacks (models the render agent edited
 * or built) to the shared lookup tables, loading their GLBs from the public bucket.
 * Bundled assets keep their local files.
 */
export async function loadCloudLibrary(): Promise<number> {
  const { data, error } = await supabase
    .from("assets")
    .select("spec,glb_path,thumbnail_path");
  if (error) return 0;
  let added = 0;
  for (const row of data) {
    if (assetById[row.spec?.id]) continue;
    const parsed = AssetSpecSchema.safeParse({
      ...row.spec,
      glbStorageKey: glbBase + row.glb_path,
      thumbnailStorageKey: row.thumbnail_path
        ? glbBase + row.thumbnail_path
        : undefined,
    });
    if (!parsed.success) continue;
    assetById[parsed.data.id] = parsed.data;
    catalog.push(parsed.data);
    added++;
  }
  return added;
}

/** Adds the signed-in user's scanned rooms to the room list, newest first. */
export async function loadCloudRooms(): Promise<string[]> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return [];
  const { data, error } = await supabase
    .from("rooms")
    .select("id,name,shell,scene")
    .not("scene", "is", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  const ids: string[] = [];
  for (const row of data) {
    const shell = RoomShellSchema.safeParse(row.shell);
    const scene = SceneSpecSchema.safeParse(row.scene);
    if (!shell.success || !scene.success) continue;
    const definition: RoomDefinition = {
      roomId: row.id,
      name: row.name,
      shell: shell.data,
      createScene: () =>
        settleImportedScene(structuredClone(scene.data), shell.data),
    };
    const index = rooms.findIndex((r) => r.roomId === row.id);
    // Update in place: the editor compares room definitions by identity.
    if (index >= 0) Object.assign(rooms[index], definition);
    else rooms.push(definition);
    cloudRoomIds.add(row.id);
    cloudShells.set(row.id, shell.data);
    ids.push(row.id);
  }
  await loadCloudDesigns();
  cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
  return ids;
}

/**
 * Saved planner designs open like rooms: each has its own id (so edits never
 * touch the original room) and reuses the original room's shell. Maps design id
 * to the scanned room it was made from.
 */
export const designParents = new Map<string, string>();

function addDesign(id: string, name: string, roomId: string, scene: SceneSpec) {
  const shell = cloudShells.get(roomId);
  if (!shell) return;
  const definition: RoomDefinition = {
    roomId: id,
    name,
    shell,
    createScene: () => structuredClone({ ...scene, id, roomId: id }),
  };
  const index = rooms.findIndex((r) => r.roomId === id);
  if (index >= 0) Object.assign(rooms[index], definition);
  else rooms.push(definition);
  designParents.set(id, roomId);
}

async function loadCloudDesigns() {
  const { data, error } = await supabase
    .from("designs")
    .select("id,name,room_id,scene")
    .eq("status", "accepted")
    .not("scene", "is", null)
    .order("created_at", { ascending: true });
  if (error) return;
  for (const row of data) {
    const scene = SceneSpecSchema.safeParse(row.scene);
    if (row.room_id && scene.success)
      addDesign(row.id, row.name, row.room_id, scene.data);
  }
}

/** Saves a planner proposal as a new, separately named design of a scanned room. */
export async function saveCloudDesign(input: {
  roomId: string;
  name: string;
  brief: unknown;
  scene: SceneSpec;
}): Promise<string> {
  const roomId = designParents.get(input.roomId) ?? input.roomId;
  if (!cloudRoomIds.has(roomId))
    throw new Error("Open a scanned room while signed in to save designs.");
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("house_id")
    .eq("id", roomId)
    .single();
  if (roomError || !room) throw new Error("Could not find the original room.");
  const id = crypto.randomUUID();
  const scene: SceneSpec = {
    ...input.scene,
    id,
    roomId: id,
    revision: 0,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await supabase.from("designs").insert({
    id,
    house_id: room.house_id,
    room_id: roomId,
    name: input.name,
    brief: input.brief,
    scene,
    status: "accepted",
  });
  if (error) throw new Error("The design could not be saved. Try again.");
  addDesign(id, input.name, roomId, scene);
  cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
  return id;
}

/** Saves edits made to an opened design back to that design only. */
export async function pushCloudDesign(scene: SceneSpec) {
  await supabase.from("designs").update({ scene }).eq("id", scene.roomId);
}

/** Scanned rooms' shells, so a newer saved copy can be settled when it is adopted. */
const cloudShells = new Map<string, RoomShell>();

/**
 * Makes a scanned arrangement valid before it is edited: pieces scanned well above
 * the floor (upper cabinets, a sink in a counter) become lifted pieces, and pieces
 * that still overlap a wall or each other are moved to the nearest valid spot by the
 * sandbox's own resolver. Valid pieces are left exactly where they were scanned.
 */
export function settleImportedScene(
  scene: SceneSpec,
  shell: RoomShell,
): SceneSpec {
  const ctx: SceneContext = {
    room: shell,
    assets: assetById,
    roomId: scene.roomId,
  };
  const objects = scene.objects.map((o) => {
    if (o.locked || (o.placement?.support ?? "floor") !== "floor") return o;
    if (o.transform.position[1] < 0.35) return o;
    // A raised piece becomes a normal lifted piece (what Space-lifting produces), so it
    // keeps planar dragging, vertical sliding and snapping. If it was scanned sunk a
    // little into the furniture below (a sink in a counter), it rests on that top.
    const rested = onNearestSurface(scene, o, shell, assetById);
    const dy = rested.transform.position[1] - o.transform.position[1];
    const onTop =
      rested.placement?.support === "object" && dy > -0.05 && dy < 0.35;
    return {
      ...o,
      transform: onTop ? rested.transform : o.transform,
      placement: { support: "floor" as const, float: true },
    };
  });
  const draft: SceneSpec = { ...scene, objects };
  const invalid = new Set(
    objects.filter((o) => !validateObject(draft, o, ctx).ok).map((o) => o.id),
  );
  if (!invalid.size) return draft;
  const accepted = {
    ...draft,
    objects: objects.filter((o) => !invalid.has(o.id)),
  };
  const result = resolveDraft(accepted, draft, ctx);
  if (!result.ok) return draft;
  const placed = new Map(result.scene.objects.map((o) => [o.id, o]));
  // Anything the resolver could not place keeps its scanned position.
  return shrinkToFit(
    { ...draft, objects: draft.objects.map((o) => placed.get(o.id) ?? o) },
    ctx,
  );
}

/**
 * RoomPlan sizes are only accurate to a few centimetres: a wall-to-wall bathtub can
 * come out a millimetre wider than its nook, and corner cabinets can overlap. Shrink
 * each piece that is still invalid by up to 25%, nudging it if needed, until it fits.
 */
function shrinkToFit(scene: SceneSpec, ctx: SceneContext): SceneSpec {
  let current = scene;
  for (const original of scene.objects) {
    const o = current.objects.find((p) => p.id === original.id)!;
    if (o.locked || validateObject(current, o, ctx).ok) continue;
    for (const factor of [
      0.99, 0.98, 0.96, 0.94, 0.92, 0.88, 0.84, 0.8, 0.75,
    ]) {
      const smaller = {
        ...o,
        dimensionsM: o.dimensionsM.map(
          (n) => n * factor,
        ) as typeof o.dimensionsM,
      };
      const trial = {
        ...current,
        objects: current.objects.map((p) => (p.id === o.id ? smaller : p)),
      };
      if (validateObject(trial, smaller, ctx).ok) {
        current = trial;
        break;
      }
      // Smaller may still need a nudge (a gap from the wall, out of a neighbour).
      const others = {
        ...trial,
        objects: trial.objects.filter((p) => p.id !== o.id),
      };
      const moved = resolveDraft(others, trial, ctx);
      const fitted = moved.ok && moved.scene.objects.find((p) => p.id === o.id);
      if (moved.ok && fitted && validateObject(moved.scene, fitted, ctx).ok) {
        current = moved.scene;
        break;
      }
    }
  }
  // One invalid piece blocks every Accept in the room, so a piece that still cannot
  // fit (usually RoomPlan detecting one cabinet twice, or a box cut by a wall) is
  // left out of the editable scene and named when the room opens.
  const dropped = current.objects.filter(
    (o) => !o.locked && !validateObject(current, o, ctx).ok,
  );
  if (dropped.length) {
    droppedPieces.set(
      scene.roomId,
      dropped.map((o) => o.displayName),
    );
    const ids = new Set(dropped.map((o) => o.id));
    current = {
      ...current,
      objects: current.objects.filter((o) => !ids.has(o.id)),
    };
  }
  return current;
}

/** Scanned pieces left out because they could not fit, by room id (for a notice). */
export const droppedPieces = new Map<string, string[]>();

export function settleCloudScene(scene: SceneSpec): SceneSpec {
  const shell = cloudShells.get(scene.roomId);
  return shell ? settleImportedScene(scene, shell) : scene;
}

/** Signs out and drops the scanned rooms from the list. */
export async function signOutCloud() {
  await supabase.auth.signOut();
  for (const id of cloudRoomIds) {
    const index = rooms.findIndex((r) => r.roomId === id);
    if (index >= 0) rooms.splice(index, 1);
  }
  cloudRoomIds.clear();
  for (const id of designParents.keys()) {
    const index = rooms.findIndex((r) => r.roomId === id);
    if (index >= 0) rooms.splice(index, 1);
  }
  designParents.clear();
  cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
}

export async function fetchCloudScene(
  roomId: string,
): Promise<SceneSpec | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("scene")
    .eq("id", roomId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = SceneSpecSchema.safeParse(data.scene);
  return parsed.success ? parsed.data : null;
}

/** Saves a newer local revision; an equal/newer saved revision is left alone. */
export async function pushCloudScene(scene: SceneSpec) {
  await supabase
    .from("rooms")
    .update({ scene, revision: scene.revision })
    .eq("id", scene.roomId)
    .lt("revision", scene.revision);
}

/** Calls back with the saved revision whenever the worker (or another tab) updates the room. */
export function watchCloudRoom(
  roomId: string,
  onRevision: (revision: number) => void,
): () => void {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${roomId}`,
      },
      (payload) => onRevision((payload.new as { revision: number }).revision),
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

/** Bumped whenever the scanned-room list changes, so the room switcher re-renders. */
export const cloudRoomsVersion = createStore(() => ({ version: 0 }));

/**
 * Adds rooms the scan worker creates while the page is open (Realtime INSERT on
 * the signed-in user's rooms) and reports each new one.
 */
export function watchNewCloudRooms(
  onNew: (name: string, roomId: string) => void,
): () => void {
  const channel = supabase
    .channel("my-new-rooms")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "rooms" },
      async () => {
        const before = new Set(cloudRoomIds);
        const ids = await loadCloudRooms();
        cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
        for (const id of ids)
          if (!before.has(id))
            onNew(rooms.find((r) => r.roomId === id)?.name ?? "New scan", id);
      },
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
