import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalog } from "@house/contracts";
import { renderQueue } from "./renderQueue";

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
const signal = () => AbortSignal.timeout(1000);
function database(rows: Record<string, unknown>[], errorCode?: string) {
  const single = vi.fn(async () => ({
    data: rows.length > 1 ? rows.shift() : rows[0],
    error: null,
  }));
  const inserted = vi.fn(async () => ({
    data: errorCode ? null : { id: "request-1" },
    error: errorCode ? { code: errorCode } : null,
  }));
  const insert = vi.fn(() => ({
    select: () => ({ abortSignal: () => ({ single: inserted }) }),
  }));
  const db = {
    from: vi.fn(() => ({
      insert,
      select: () => ({ eq: () => ({ abortSignal: () => ({ single }) }) }),
    })),
  } as unknown as SupabaseClient;
  return { db, single, insert };
}
const asset = (index = 0) => ({
  ...catalog[index],
  glbUrl: `https://example.com/${index}.glb`,
});

it("uses the owner-scoped worker queue, normalizes model URLs, and shares identical requests", async () => {
  const { db, insert } = database([
    { status: "done", asset: asset(), source: "retrieved", notes: ["Found"] },
  ]);
  const port = renderQueue(db, "room-1");
  const [a, b] = await Promise.all([
    port.resolve(request, signal()),
    port.resolve(request, signal()),
  ]);
  expect(insert).toHaveBeenCalledOnce();
  expect(insert.mock.calls[0]).toEqual([
    {
      room_id: "room-1",
      request,
      object_key: JSON.stringify(request).slice(0, 80),
    },
  ]);
  expect(a).toEqual(b);
  expect(a.asset?.glbStorageKey).toBe("https://example.com/0.glb");
});
it("waits for the worker to improve an uncertain interim match", async () => {
  const { db, single } = database([
    {
      status: "processing",
      asset: asset(),
      source: "best_effort",
      notes: ["Initial match"],
    },
    {
      status: "done",
      asset: asset(1),
      source: "reused",
      notes: ["Chosen after review"],
    },
  ]);
  const result = await renderQueue(db, undefined, { pollMs: 1 }).resolve(
    request,
    signal(),
  );
  expect(single).toHaveBeenCalledTimes(2);
  expect(result.asset?.id).toBe(catalog[1].id);
  expect(result.source).toBe("reused");
});
it("keeps a valid closest real model if improvement times out", async () => {
  const { db } = database([
    { status: "processing", asset: asset(), source: "best_effort", notes: [] },
  ]);
  const result = await renderQueue(db, undefined, {
    waitMs: 15,
    pollMs: 2,
  }).resolve(request, signal());
  expect(result.asset?.id).toBe(catalog[0].id);
  expect(result.source).toBe("best_effort");
  expect(result.notes.join()).toContain("closest available real model");
});
it.each([
  ["pending", "worker_pending"],
  ["processing", "worker_timeout"],
  ["failed", "worker_failed"],
  ["done", "no_match"],
])(
  "reports %s separately instead of hiding every failure behind a box",
  async (status, reason) => {
    const { db } = database([
      { status, source: "placeholder", asset: null, notes: [] },
    ]);
    const result = await renderQueue(db, undefined, {
      waitMs: 10,
      pollMs: 2,
    }).resolve(request, signal());
    expect(result.asset).toBeNull();
    expect(result.placeholderReason).toBe(reason);
  },
);
it("reports the missing integration table with a typed reason", async () => {
  const { db } = database([], "PGRST205");
  await expect(
    renderQueue(db).resolve(request, signal()),
  ).rejects.toMatchObject({ reason: "queue_missing" });
});
it("does not turn cancellation into a model fallback", async () => {
  const { db, insert } = database([]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderQueue(db).resolve(request, controller.signal),
  ).rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
});
