import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalog } from "@house/contracts";
import { renderQueue } from "./renderQueue";

it("uses the existing owner-scoped worker queue, returns model URLs, and shares identical requests", async () => {
  const inserted = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: { id: "request-1" }, error: null }),
    }),
  }));
  const single = vi.fn(async () => ({
    data: {
      status: "done",
      asset: { ...catalog[0], glbUrl: "https://example.com/model.glb" },
      source: "retrieved",
      notes: ["Found"],
    },
    error: null,
  }));
  const db = {
    from: vi.fn(() => ({
      insert: inserted,
      select: () => ({ eq: () => ({ single }) }),
    })),
  } as unknown as SupabaseClient;
  const port = renderQueue(db, "room-1");
  const request = {
    schemaVersion: 1 as const,
    category: "chair",
    description: "Oak chair",
    styles: ["minimal"],
    colors: ["cream"],
    materials: ["oak"],
    targetDimensionsM: [1, 1, 1] as [number, number, number],
    allowGeneration: false,
  };
  const signal = AbortSignal.timeout(1000);
  const [a, b] = await Promise.all([
    port.resolve(request, signal),
    port.resolve(request, signal),
  ]);
  expect(inserted).toHaveBeenCalledOnce();
  expect(inserted.mock.calls[0]).toEqual([
    {
      room_id: "room-1",
      request,
      object_key: JSON.stringify(request).slice(0, 80),
    },
  ]);
  expect(a).toEqual(b);
  expect(a.asset?.glbStorageKey).toBe("https://example.com/model.glb");
  expect(a.source).toBe("retrieved");
});

it("does not invent a local match if the scanner request table is unavailable", async () => {
  const db = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: "PGRST205" } }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  await expect(
    renderQueue(db).resolve(
      {
        schemaVersion: 1,
        category: "chair",
        description: "",
        styles: [],
        colors: [],
        materials: [],
        targetDimensionsM: [1, 1, 1],
        allowGeneration: false,
      },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow("queue is unavailable");
});
