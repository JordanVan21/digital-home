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
  onWall,
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
      name: `Scan · ${row.name}`,
      shell: shell.data,
      createScene: () => settleImportedScene(structuredClone(scene.data), shell.data),
    };
    const index = rooms.findIndex((r) => r.roomId === row.id);
    // Update in place: the editor compares room definitions by identity.
    if (index >= 0) Object.assign(rooms[index], definition);
    else rooms.push(definition);
    cloudRoomIds.add(row.id);
    cloudShells.set(row.id, shell.data);
    ids.push(row.id);
  }
  cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
  return ids;
}

/** Scanned rooms' shells, so a newer saved copy can be settled when it is adopted. */
const cloudShells = new Map<string, RoomShell>();

/**
 * Makes a scanned arrangement valid before it is edited: pieces scanned well above
 * the floor next to a wall (upper cabinets, shelves) hang on that wall, and pieces
 * that still overlap a wall or each other are moved to the nearest valid spot by the
 * sandbox's own resolver. Valid pieces are left exactly where they were scanned.
 */
export function settleImportedScene(scene: SceneSpec, shell: RoomShell): SceneSpec {
  const ctx: SceneContext = { room: shell, assets: assetById, roomId: scene.roomId };
  const objects = scene.objects.map((o) => {
    if (o.locked || (o.placement?.support ?? "floor") !== "floor") return o;
    if (o.transform.position[1] < 0.35) return o;
    // Resting on the furniture right below (sink on a counter) beats hanging on a wall.
    const rested = onNearestSurface(scene, o, shell, assetById);
    if (
      rested.placement?.support === "object" &&
      Math.abs(rested.transform.position[1] - o.transform.position[1]) < 0.4
    )
      return rested;
    const mounted = onWall(shell, { ...o, placement: { support: "wall" } });
    const shift = Math.hypot(
      mounted.transform.position[0] - o.transform.position[0],
      mounted.transform.position[2] - o.transform.position[2],
    );
    return shift <= 0.35 ? mounted : o;
  });
  const draft: SceneSpec = { ...scene, objects };
  const invalid = new Set(
    objects.filter((o) => !validateObject(draft, o, ctx).ok).map((o) => o.id),
  );
  if (!invalid.size) return draft;
  const accepted = { ...draft, objects: objects.filter((o) => !invalid.has(o.id)) };
  const result = resolveDraft(accepted, draft, ctx);
  if (!result.ok) return draft;
  const placed = new Map(result.scene.objects.map((o) => [o.id, o]));
  // Anything the resolver could not place keeps its scanned position.
  return { ...draft, objects: draft.objects.map((o) => placed.get(o.id) ?? o) };
}

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
  cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
}

export async function fetchCloudScene(roomId: string): Promise<SceneSpec | null> {
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
      { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
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
export function watchNewCloudRooms(onNew: (name: string, roomId: string) => void): () => void {
  const channel = supabase
    .channel("my-new-rooms")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "rooms" }, async () => {
      const before = new Set(cloudRoomIds);
      const ids = await loadCloudRooms();
      cloudRoomsVersion.setState((s) => ({ version: s.version + 1 }));
      for (const id of ids)
        if (!before.has(id)) onNew(rooms.find((r) => r.roomId === id)?.name ?? "New scan", id);
    })
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
