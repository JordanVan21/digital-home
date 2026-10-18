import { describe, expect, it, vi } from "vitest";
import { createPlannerModel } from "./model";

describe("server-only model adapter", () => {
  it("bounds interrupted-connection retries and never forwards transport details", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("private transport details");
    });
    const model = createPlannerModel(
      {
        apiKey: "secret",
        baseUrl: "https://api.deepseek.com",
        textModel: "pro",
        visionModel: "flash",
      },
      fetcher,
    );
    await expect(
      model.complete(
        { task: "plan", instructions: "JSON", data: {}, views: [] },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("connection was interrupted");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  const settings = {
    apiKey: "server-secret",
    baseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-pro",
    visionModel: "deepseek-flash",
  };
  it("routes text to Pro and actual JPEG views to Flash, without putting the key in the body", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"verdict":"ready"}' } }],
          }),
        ),
    );
    const model = createPlannerModel(settings, fetcher);
    const request = {
      task: "plan" as const,
      instructions: "Return JSON",
      data: { room: "test" },
      views: [],
    };
    await model.complete(request, AbortSignal.timeout(1000));
    await model.complete(
      {
        ...request,
        task: "review",
        views: [
          {
            name: "top",
            image: "data:image/jpeg;base64,/9j/AA==",
            unavailableObjectIds: [],
          },
        ],
      },
      AbortSignal.timeout(1000),
    );
    const first = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const second = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(first[1].body as string).model).toBe("deepseek-v4-pro");
    const body = JSON.parse(second[1].body as string);
    expect(body.model).toBe("deepseek-flash");
    expect(body.messages[1].content[1].image_url.url).toBe(
      "data:image/jpeg;base64,/9j/AA==",
    );
    expect(second[1].body).not.toContain("server-secret");
    expect(second[1].headers).toMatchObject({
      Authorization: "Bearer server-secret",
    });
  });
  it("no key produces a clear setup error without making a call", async () => {
    const fetcher = vi.fn();
    await expect(
      createPlannerModel({ ...settings, apiKey: undefined }, fetcher).complete(
        { task: "plan", instructions: "", data: {}, views: [] },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("AI is not set up");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not forward upstream error bodies containing private input", async () => {
    const model = createPlannerModel(
      settings,
      async () => new Response("private input server-secret", { status: 401 }),
    );
    await expect(
      model.complete(
        { task: "plan", instructions: "", data: {}, views: [] },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("AI request failed (401)");
  });
});
