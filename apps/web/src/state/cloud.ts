import { createClient } from "@supabase/supabase-js";
import {
  AssetSpecSchema,
  RoomShellSchema,
  SceneSpecSchema,
  assetById,
  catalog,
  type RoomDefinition,
  type SceneSpec,
} from "@house/contracts";
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
      createScene: () => structuredClone(scene.data),
    };
    const index = rooms.findIndex((r) => r.roomId === row.id);
    if (index >= 0) rooms[index] = definition;
    else rooms.push(definition);
    cloudRoomIds.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

/** Signs out and drops the scanned rooms from the list. */
export async function signOutCloud() {
  await supabase.auth.signOut();
  for (const id of cloudRoomIds) {
    const index = rooms.findIndex((r) => r.roomId === id);
    if (index >= 0) rooms.splice(index, 1);
  }
  cloudRoomIds.clear();
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
