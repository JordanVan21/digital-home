import { expect, it, vi } from "vitest";
import { checkReadiness } from "./readiness";

const config = {
  apiKey: "private-model-key",
  supabaseUrl: "https://example.com",
  supabaseAnonKey: "public-key",
};
const catalog = { assets: [], source: "bundled" as const };
it("detects a missing queue before paid model calls, including when signed out", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ code: "PGRST205" }), { status: 404 }),
  );
  const state = await checkReadiness(config, catalog, undefined, fetcher);
  expect(state.liveReady).toBe(false);
  expect(state.renderStatus).toBe("queue_missing");
  expect(state.message).toContain("not connected");
  expect(JSON.stringify(state)).not.toContain("private-model-key");
});
it("requires sign-in even if the queue is publicly discoverable", async () => {
  const state = await checkReadiness(
    config,
    catalog,
    undefined,
    async () => new Response("[]"),
  );
  expect(state.renderStatus).toBe("sign_in_required");
  expect(state.liveReady).toBe(false);
});
it("uses only the user's JWT for the owner-scoped readiness read", async () => {
  const fetcher = vi.fn(async () => new Response("[]"));
  const state = await checkReadiness(config, catalog, "user-jwt", fetcher);
  expect(state.liveReady).toBe(true);
  const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(args[1].headers).toMatchObject({
    Authorization: "Bearer user-jwt",
    apikey: "public-key",
  });
});
