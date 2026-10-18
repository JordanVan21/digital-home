import type { ResponseOutputItem, Tool } from "openai/resources/responses/responses";
import { buildBoxGlb, inspectGlb } from "@house/asset-service";
import { BlenderError, MEASURE_SCRIPT, MESH_NAMES_SCRIPT, type BlenderPort, type PythonResult } from "./blender";
import type { AgentModel, ModelReply } from "./model";

export type ScriptedCall = { name: string; args?: unknown };
/** What a scripted model does on each request: tool calls, or plain text to finish. */
export type Turn = ScriptedCall[] | string;

let callCounter = 0;
/** Deterministic stand-in for an LLM: replays turns, or computes them from the history. */
export function scriptedModel(
  script: Turn[] | ((turnIndex: number, input: unknown[]) => Turn),
  opts: { supportsImages?: boolean } = {}
): AgentModel & { requests: number; inputs: unknown[][]; toolNames: string[][]; instructions: string[] } {
  const model = {
    provider: "scripted", model: "scripted", supportsImages: opts.supportsImages ?? false, requests: 0, inputs: [] as unknown[][], toolNames: [] as string[][], instructions: [] as string[],
    async respond(input: unknown[], instructions?: string, tools?: Tool[]): Promise<ModelReply> {
      model.instructions.push(instructions ?? "");
      model.toolNames.push((tools ?? []).map((t) => (t as { name?: string }).name ?? ""));
      const index = model.requests++;
      model.inputs.push([...input]);
      const turn = typeof script === "function" ? script(index, input) : script[index] ?? "done";
      const output: ResponseOutputItem[] = typeof turn === "string"
        ? ([{ type: "message", id: `m${index}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: turn, annotations: [] }] }] as ResponseOutputItem[])
        : (turn.map((c) => ({ type: "function_call", id: `f${++callCounter}`, call_id: `c${callCounter}`, name: c.name, arguments: JSON.stringify(c.args ?? {}), status: "completed" })) as ResponseOutputItem[]);
      return { output, text: typeof turn === "string" ? turn : "", completed: true, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return model;
}

/** Last tool result the model would have seen, parsed. */
export function lastToolOutput(input: unknown[]): any {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i] as { type?: string; output?: unknown };
    if (item.type === "function_call_output") return JSON.parse(typeof item.output === "string" ? item.output : (item.output as { text: string }[])[0].text);
  }
  return null;
}

/**
 * Fake of the BlenderPort *protocol*, not of Blender: it understands toy
 * `BOX w h d` and `SCALE x y z` lines instead of bpy, imports real GLBs by
 * measuring them, and exports a matching box GLB. It exercises the
 * agent loop, guard, gate and registry end to end; it says nothing about
 * whether real Blender accepts model-written Python.
 */
export class FakeBlender implements BlenderPort {
  size: [number, number, number] | null = null;
  names: string[] = [];
  color: [number, number, number, number] | null = null;
  executed: string[] = [];
  resets = 0;
  active = 0;
  maxActive = 0;
  unreachable = false;
  delayMs = 0;

  private check() { if (this.unreachable) throw new BlenderError("Cannot reach Blender MCP at 127.0.0.1:9876 (ECONNREFUSED)."); }
  async runPython(code: string): Promise<PythonResult> {
    this.check();
    if (code === MEASURE_SCRIPT) {
      if (!this.size) return { ok: true, output: JSON.stringify({ mesh_objects: 0 }) };
      const [w, h, d] = this.size;
      return { ok: true, output: JSON.stringify({ mesh_objects: 1, triangles: 12, gltf_dims_width_height_depth: [w, h, d] }) };
    }
    if (code === MESH_NAMES_SCRIPT) return { ok: true, output: JSON.stringify(this.names) };
    this.executed.push(code);
    const box = /BOX\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(code);
    if (box) { this.size = [Number(box[1]), Number(box[2]), Number(box[3])]; this.names = ["box"]; return { ok: true, output: "built" }; }
    const paint = /PAINT\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(code);
    if (paint) { this.color = [Number(paint[1]), Number(paint[2]), Number(paint[3]), 1]; return { ok: true, output: "painted" }; }
    const scale = /SCALE\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(code);
    if (scale && this.size) { this.size = this.size.map((n, i) => n * Number(scale[i + 1])) as [number, number, number]; return { ok: true, output: "scaled" }; }
    return { ok: false, output: "NameError: toy interpreter only understands 'BOX w h d' and 'SCALE x y z'" };
  }
  async screenshot() { return null; }
  async exportGlb(): Promise<Uint8Array> {
    this.check();
    this.active++; this.maxActive = Math.max(this.maxActive, this.active);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    this.active--;
    if (!this.size) throw new BlenderError("No mesh objects to export");
    return buildBoxGlb({ size: this.size, center: [0.3, this.size[1] / 2, -0.2], ...(this.color ? { baseColor: this.color } : {}) });
  }
  imported: Uint8Array[] = [];
  async importGlb(glb: Uint8Array) {
    this.check();
    this.imported.push(glb);
    this.size = inspectGlb(glb).size; // glTF dims: width, height, depth
    this.names = ["imported_mesh"];
  }
  async reset() { this.check(); this.resets++; this.size = null; this.names = []; this.color = null; }
}
