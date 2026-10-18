import type { ResponseInputItem, Tool } from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import type { AgentModel } from "./model";

export type ToolOutput<T> = {
  /** JSON shown to the model. */
  output: Record<string, unknown>;
  /** PNG shown to the model, only sent if the model supports images. */
  imagePng?: Uint8Array;
  /** Set to end the loop successfully with this value. */
  done?: T;
};

export type AgentTool<T> = {
  name: string;
  description: string;
  /** JSON Schema sent to the model. */
  parameters: Record<string, unknown>;
  /** Source of truth for validation; arguments that fail it never reach `run`. */
  schema: ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are validated by each tool's `schema` before run
  run(args: any, signal?: AbortSignal): Promise<ToolOutput<T>>;
};

/** Thrown by a tool when retrying is pointless (e.g. Blender is unreachable); aborts the whole loop. */
export class FatalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalToolError";
  }
}

export type ToolTrace = { name: string; arguments: unknown; ok: boolean; summary: string };
export type LoopResult<T> = {
  done: T | null;
  trace: ToolTrace[];
  usage: { inputTokens: number; outputTokens: number; requests: number };
  endedBecause: "done" | "model_finished" | "round_limit" | "call_limit" | "timeout" | "aborted";
  finalText: string;
};

export type LoopOptions = { maxRounds: number; maxToolCalls: number; /** Wall-clock budget for the whole loop. */ maxMs?: number };

const toToolDef = (t: AgentTool<unknown>): Tool => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false });
const summarize = (value: unknown) => JSON.stringify(value).slice(0, 300);

/**
 * Bounded tool-calling loop. Tools run sequentially, arguments are validated
 * before execution, tool failures go back to the model as results (never throw),
 * and the loop ends when a tool returns `done`, the model stops, or a limit hits.
 */
export async function runToolLoop<T>(params: {
  model: AgentModel;
  instructions: string;
  input: ResponseInputItem[];
  tools: AgentTool<T>[];
  options: LoopOptions;
  signal?: AbortSignal;
}): Promise<LoopResult<T>> {
  const { model, instructions, tools, options, signal } = params;
  const input = [...params.input];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const defs = tools.map(toToolDef);
  const trace: ToolTrace[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  const finish = (done: T | null, endedBecause: LoopResult<T>["endedBecause"], finalText = ""): LoopResult<T> =>
    ({ done, trace, usage, endedBecause, finalText });

  const started = Date.now();
  for (let round = 0; round < options.maxRounds; round++) {
    if (signal?.aborted) return finish(null, "aborted");
    if (options.maxMs !== undefined && Date.now() - started > options.maxMs) return finish(null, "timeout");
    const reply = await model.respond(input, instructions, defs, signal);
    usage.requests++;
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    if (!reply.completed) throw new Error("The model stopped before completing its turn.");
    for (const item of reply.output) {
      if (item.type === "reasoning" || item.type === "message" || item.type === "function_call") input.push(item as ResponseInputItem);
    }
    const calls = reply.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return finish(null, "model_finished", reply.text);

    for (const call of calls) {
      if (call.type !== "function_call") continue;
      if (trace.length >= options.maxToolCalls) return finish(null, "call_limit");
      if (options.maxMs !== undefined && Date.now() - started > options.maxMs) return finish(null, "timeout");
      if (signal?.aborted) return finish(null, "aborted");
      const tool = byName.get(call.name);
      let result: ToolOutput<T>;
      let ok = true;
      let args: unknown = null;
      if (!tool) {
        ok = false;
        result = { output: { ok: false, error: `Unknown tool ${call.name}` } };
      } else {
        try {
          args = JSON.parse(call.arguments);
          const parsed = tool.schema.safeParse(args);
          if (!parsed.success) {
            ok = false;
            result = { output: { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` } };
          } else {
            result = await tool.run(parsed.data, signal);
          }
        } catch (error) {
          if (signal?.aborted) return finish(null, "aborted");
          if (error instanceof FatalToolError) throw error;
          ok = false;
          result = { output: { ok: false, error: error instanceof Error ? error.message : "Tool failed" } };
        }
      }
      trace.push({ name: call.name, arguments: args, ok: ok && result.output.ok !== false, summary: summarize(result.output) });
      const content = result.imagePng && model.supportsImages
        ? [
            { type: "input_text" as const, text: JSON.stringify(result.output) },
            { type: "input_image" as const, detail: "low" as const, image_url: `data:image/png;base64,${Buffer.from(result.imagePng).toString("base64")}` },
          ]
        : JSON.stringify(result.output);
      input.push({ type: "function_call_output", call_id: call.call_id, output: content } as ResponseInputItem);
      if (result.done !== undefined) return finish(result.done, "done");
    }
  }
  return finish(null, "round_limit");
}
