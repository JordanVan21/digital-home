import type { PlannerReadiness } from "@house/aesthetic-planner";
import type { CatalogConfig, CatalogSnapshot } from "./catalog";

/** Reads no room rows and writes nothing. A missing queue is detected before any paid model call. */
export async function checkReadiness(
  config: CatalogConfig & { apiKey?: string },
  catalog: CatalogSnapshot,
  jwt?: string,
  fetcher: typeof fetch = fetch,
): Promise<PlannerReadiness> {
  let renderStatus: PlannerReadiness["renderStatus"] = "not_configured";
  if (config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const response = await fetcher(
        `${config.supabaseUrl}/rest/v1/asset_requests?select=id&limit=0`,
        {
          headers: {
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${jwt ?? config.supabaseAnonKey}`,
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (response.ok) renderStatus = jwt ? "ready" : "sign_in_required";
      else {
        const error = (await response.json()) as { code?: string };
        renderStatus =
          error.code === "PGRST205" || error.code === "42P01"
            ? "queue_missing"
            : response.status === 401 || response.status === 403
              ? "sign_in_required"
              : "unavailable";
      }
    } catch {
      renderStatus = "unavailable";
    }
  }
  const message = !config.apiKey
    ? "AI is not set up yet. You can try the catalog demo."
    : renderStatus === "queue_missing"
      ? "Live furniture requests are not connected yet. Try the catalog demo."
      : renderStatus === "sign_in_required"
        ? "Sign in to request furniture from the live service."
        : renderStatus === "ready"
          ? "Ready to send furniture requests."
          : "The live furniture service is unavailable. You can still try the catalog demo.";
  return {
    liveReady: !!config.apiKey && renderStatus === "ready",
    aiConfigured: !!config.apiKey,
    renderStatus,
    catalogCount: catalog.assets.length,
    catalogSource: catalog.source,
    message,
  };
}
