import type { PlannerModel } from "@house/aesthetic-planner";

/** Server-only adapter. JSON is validated by the planner, including one correction attempt. */
export function createPlannerModel(
  config: {
    apiKey?: string;
    baseUrl: string;
    textModel: string;
    visionModel: string;
  },
  fetcher: typeof fetch = fetch,
): PlannerModel {
  return {
    async complete(request, signal) {
      if (!config.apiKey)
        throw new Error(
          "AI is not set up. Set DEEPSEEK_API_KEY in the server environment.",
        );
      const images = request.views.map((v) => ({
        type: "image_url",
        image_url: { url: v.image },
      }));
      const send = () =>
        fetcher(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model:
              request.task === "review" ? config.visionModel : config.textModel,
            messages: [
              { role: "system", content: request.instructions },
              {
                role: "user",
                content: [
                  { type: "text", text: JSON.stringify(request.data) },
                  ...images,
                ],
              },
            ],
            response_format: { type: "json_object" },
            max_tokens: 12000,
            thinking: { type: "disabled" },
          }),
        });
      let response: Response;
      try {
        response = await send();
      } catch {
        signal.throwIfAborted();
        try {
          response = await send();
        } catch {
          throw new Error(
            "The AI connection was interrupted. Please try again.",
          );
        }
      }
      // Never include upstream bodies/headers in client errors: they can contain private inputs.
      if (!response.ok)
        throw new Error(
          `AI request failed (${response.status}). Check the server's model settings and try again.`,
        );
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}
