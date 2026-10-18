import type { SupabaseClient } from "@supabase/supabase-js";
import { AssetSpecSchema } from "@house/contracts";
import type { RenderPort } from "@house/aesthetic-planner";

/** Existing scanner worker owns all retrieval/model work. No render-agent code is copied here. */
export function renderQueue(db: SupabaseClient, roomId?: string): RenderPort {
  const requests = new Map<string, ReturnType<RenderPort["resolve"]>>();
  return {
    resolve(request, signal) {
      const key = JSON.stringify(request);
      const previous = requests.get(key);
      if (previous) return previous;
      const result = (async () => {
        const inserted = await db
          .from("asset_requests")
          .insert({
            ...(roomId ? { room_id: roomId } : {}),
            request,
            object_key: key.slice(0, 80),
          })
          .select("id")
          .single();
        if (inserted.error)
          throw new Error(
            "The render request queue is unavailable. Check scanner integration.",
          );
        const until = Date.now() + 12_000;
        while (Date.now() < until) {
          signal.throwIfAborted();
          const reply = await db
            .from("asset_requests")
            .select("status,asset,source,notes")
            .eq("id", inserted.data.id)
            .single();
          if (reply.error) throw new Error("Could not read render request.");
          const row = reply.data;
          if (row.asset || row.status === "done" || row.status === "failed") {
            const spec = row.asset
              ? AssetSpecSchema.parse({
                  ...row.asset,
                  glbStorageKey: row.asset.glbUrl ?? row.asset.glbStorageKey,
                })
              : null;
            const source = [
              "retrieved",
              "reused",
              "modified",
              "generated",
              "best_effort",
              "placeholder",
            ].includes(row.source)
              ? row.source
              : "placeholder";
            return {
              asset: spec,
              source: source as
                | "retrieved"
                | "reused"
                | "modified"
                | "generated"
                | "best_effort"
                | "placeholder",
              notes: Array.isArray(row.notes)
                ? (row.notes.filter(
                    (v: unknown) => typeof v === "string",
                  ) as string[])
                : [],
            };
          }
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              signal.removeEventListener("abort", aborted);
              resolve();
            };
            const timer = setTimeout(done, 500);
            const aborted = () => {
              clearTimeout(timer);
              reject(new Error("Aborted"));
            };
            signal.addEventListener("abort", aborted, { once: true });
          });
        }
        return {
          asset: null,
          source: "placeholder" as const,
          notes: [
            "Render worker did not answer within 12 seconds. Appearance unverified; model swap-ins come in a later stage.",
          ],
        };
      })();
      requests.set(key, result);
      return result;
    },
  };
}
