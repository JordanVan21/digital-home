import OpenAI from "openai";
import type { ResponseInputItem, ResponseOutputItem, Tool } from "openai/resources/responses/responses";

export interface ModelReply {
  output: ResponseOutputItem[];
  text: string;
  completed: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Provider-neutral model port. Same shape as the planner branch's AgentModel so
 * the two can share one provider module when the branches merge.
 */
export interface AgentModel {
  provider: string;
  model: string;
  /** True only if the model accepts images in tool results (viewport screenshots). */
  supportsImages: boolean;
  respond(input: ResponseInputItem[], instructions: string, tools: Tool[], signal?: AbortSignal): Promise<ModelReply>;
}

export function createModel(config: {
  provider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  reasoningEffort?: "low" | "high";
}): AgentModel {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.provider === "deepseek" ? { baseURL: "https://api.deepseek.com" } : {}),
    timeout: 120_000,
    maxRetries: 1,
  });
  return {
    provider: config.provider,
    model: config.model,
    // DeepSeek's API is text-only; OpenAI models used here accept images.
    supportsImages: config.provider === "openai",
    async respond(input, instructions, tools, signal) {
      const response = await client.responses.create(
        {
          model: config.model,
          input,
          instructions,
          tools,
          reasoning: { effort: config.reasoningEffort ?? "low" },
          max_output_tokens: 16384,
          ...(config.provider === "openai" ? { store: false, parallel_tool_calls: false, include: ["reasoning.encrypted_content"] } : {}),
        },
        { signal }
      );
      return {
        output: response.output,
        text: response.output_text,
        completed: response.status === "completed",
        usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      };
    },
  };
}
