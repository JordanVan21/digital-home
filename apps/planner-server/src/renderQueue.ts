import type { SupabaseClient } from "@supabase/supabase-js";
import { AssetSpecSchema } from "@house/contracts";
import {
  ModelSourcingError,
  type ModelResolution,
  type RenderPort,
} from "@house/aesthetic-planner";

const sources = [
  "retrieved",
  "reused",
  "modified",
  "generated",
  "best_effort",
  "placeholder",
] as const;
const queueMissing = (code?: string) => code === "PGRST205" || code === "42P01";
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });

/** The existing worker owns retrieval and model creation. Only its verified results are returned. */
export function renderQueue(
  db: SupabaseClient,
  roomId?: string,
  options: { waitMs?: number; pollMs?: number } = {},
): RenderPort {
  const requests = new Map<string, ReturnType<RenderPort["resolve"]>>();
  return {
    resolve(request, signal) {
      const key = JSON.stringify(request);
      const previous = requests.get(key);
      if (previous) return previous;
      const result = (async (): Promise<ModelResolution> => {
        signal.throwIfAborted();
        const waitMs = Math.max(1, Math.min(options.waitMs ?? 45_000, 90_000));
        const deadline = Date.now() + waitMs;
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(waitMs)]);
        const inserted = await db
          .from("asset_requests")
          .insert({
            ...(roomId ? { room_id: roomId } : {}),
            request,
            object_key: key.slice(0, 80),
          })
          .select("id")
          .abortSignal(bounded)
          .single();
        if (inserted.error || !inserted.data)
          throw new ModelSourcingError(
            queueMissing(inserted.error?.code)
              ? "queue_missing"
              : "request_failed",
            queueMissing(inserted.error?.code)
              ? "Live furniture requests are not connected yet. Try the catalog demo."
              : "Could not send this furniture request. Check your connection and sign-in.",
          );
        let interim: ModelResolution | undefined;
        let lastStatus = "pending";
        try {
          while (Date.now() < deadline) {
            signal.throwIfAborted();
            const reply = await db
              .from("asset_requests")
              .select("status,asset,source,notes")
              .eq("id", inserted.data.id)
              .abortSignal(bounded)
              .single();
            if (reply.error || !reply.data)
              throw new ModelSourcingError(
                "request_failed",
                "Could not read the furniture service's response.",
              );
            const row = reply.data;
            lastStatus = row.status;
            const source = sources.includes(row.source)
              ? (row.source as ModelResolution["source"])
              : "placeholder";
            const notes = Array.isArray(row.notes)
              ? (row.notes.filter(
                  (v: unknown) => typeof v === "string",
                ) as string[])
              : [];
            if (row.asset) {
              const asset = AssetSpecSchema.safeParse({
                ...row.asset,
                glbStorageKey: row.asset.glbUrl ?? row.asset.glbStorageKey,
              });
              if (asset.success) interim = { asset: asset.data, source, notes };
              else if (row.status === "done")
                return {
                  asset: null,
                  source: "placeholder",
                  placeholderReason: "invalid_model",
                  notes: [
                    "The returned model record could not be read. Please try again.",
                  ],
                };
            }
            // A best-effort interim match may still be improved by the worker. Do not stop early for it.
            if (
              interim &&
              (row.status === "done" ||
                ["retrieved", "reused", "modified", "generated"].includes(
                  source,
                ))
            )
              return interim;
            if (row.status === "done" || row.status === "failed")
              return {
                asset: null,
                source: "placeholder",
                placeholderReason:
                  row.status === "failed" ? "worker_failed" : "no_match",
                notes: [
                  ...notes,
                  row.status === "failed"
                    ? "The furniture service could not finish this request."
                    : "No suitable catalog model was found for this request.",
                ],
              };
            await pause(
              Math.min(options.pollMs ?? 500, deadline - Date.now()),
              bounded,
            );
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!bounded.aborted) throw error;
        }
        if (interim?.asset)
          return {
            ...interim,
            source: "best_effort",
            notes: [
              ...interim.notes,
              "The improved match is not ready. Showing the closest available real model for review.",
            ],
          };
        return {
          asset: null,
          source: "placeholder",
          placeholderReason:
            lastStatus === "pending" ? "worker_pending" : "worker_timeout",
          notes: [
            lastStatus === "pending"
              ? "This request is still waiting for the furniture service. Check that the render worker is running, then try again."
              : "The furniture service is still working on this model. Please try again shortly.",
          ],
        };
      })();
      requests.set(key, result);
      void result.catch(() => requests.delete(key));
      return result;
    },
  };
}
