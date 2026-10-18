import { expect, it, vi } from "vitest";
import { catalog, fixtureId } from "@house/contracts";
import { createCatalogSource } from "./catalog";

it("merges verified shared metadata, normalizes storage URLs, and caches one public read", async () => {
  const extra = { ...catalog[0], id: fixtureId(9999) };
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify([
          { spec: extra, glb_path: "/models/real chair.glb" },
          {
            spec: { ...extra, id: fixtureId(9998), licenseStatus: "pending" },
            glb_path: "unverified.glb",
          },
          {
            spec: { ...extra, id: fixtureId(9997) },
            glb_path: "../private.glb",
          },
        ]),
      ),
  );
  const source = createCatalogSource(
    { supabaseUrl: "https://example.com", supabaseAnonKey: "public-key" },
    fetcher,
  );
  const [a, b] = await Promise.all([source.list(), source.list()]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(a).toEqual(b);
  expect(a.source).toBe("shared");
  expect(a.assets).toHaveLength(catalog.length + 1);
  expect(a.assets.find((x) => x.id === extra.id)?.glbStorageKey).toBe(
    "https://example.com/storage/v1/object/public/glbs/models/real%20chair.glb",
  );
});
it("retains real bundled models when the shared catalog is offline", async () => {
  const state = await createCatalogSource(
    { supabaseUrl: "https://example.com", supabaseAnonKey: "public-key" },
    async () => {
      throw new Error("Offline");
    },
  ).list();
  expect(state.source).toBe("bundled");
  expect(state.assets.length).toBeGreaterThan(50);
});
