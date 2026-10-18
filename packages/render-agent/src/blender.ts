import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class BlenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlenderError";
  }
}

export type PythonResult = { ok: boolean; output: string };

/** What the agent needs from one running Blender. Implemented over the Blender MCP socket or by a test fake. */
export interface BlenderPort {
  /** Runs Python inside Blender. `output` is captured stdout, or the error text when !ok. */
  runPython(code: string, signal?: AbortSignal): Promise<PythonResult>;
  /** PNG of the 3D viewport, or null when unavailable (e.g. headless Blender). */
  screenshot(signal?: AbortSignal): Promise<Uint8Array | null>;
  /** Self-contained GLB of all mesh objects, Y-up, modifiers applied. */
  exportGlb(signal?: AbortSignal): Promise<Uint8Array>;
  /** Empties the scene and sets metric units so jobs cannot leak into each other. */
  reset(signal?: AbortSignal): Promise<void>;
}

// --- trusted scripts (not model-written; they bypass the bpy guard) -----------

export const RESET_SCRIPT = `
import bpy
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.images):
    for block in list(coll):
        if block.users == 0:
            coll.remove(block)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0
print("reset-ok")
`;

/** Prints one JSON line. Blender is Z-up; gltf_dims maps to our [width, height, depth] = [X, Z, Y]. */
export const MEASURE_SCRIPT = `
import bpy, json
dg = bpy.context.evaluated_depsgraph_get()
mn = [1e18, 1e18, 1e18]
mx = [-1e18, -1e18, -1e18]
tris = 0
count = 0
names = []
for obj in bpy.data.objects:
    if obj.type != 'MESH' or obj.hide_viewport:
        continue
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    count += 1
    names.append(obj.name)
    for v in me.vertices:
        w = obj.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
    tris += sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
    ev.to_mesh_clear()
if count == 0:
    print(json.dumps({"mesh_objects": 0}))
else:
    size = [mx[i] - mn[i] for i in range(3)]
    print(json.dumps({
        "mesh_objects": count, "names": names[:40], "triangles": tris,
        "blender_size_xyz": [round(s, 4) for s in size],
        "gltf_dims_width_height_depth": [round(size[0], 4), round(size[2], 4), round(size[1], 4)],
        "lowest_z": round(mn[2], 4),
    }))
`;

export const exportScript = (path: string) => `
import bpy
bpy.ops.object.select_all(action='DESELECT')
first = None
for obj in bpy.data.objects:
    if obj.type == 'MESH' and not obj.hide_viewport:
        obj.select_set(True)
        first = first or obj
if first is None:
    raise RuntimeError("No mesh objects to export")
bpy.context.view_layer.objects.active = first
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(path)}, export_format='GLB', use_selection=True,
    export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
print("export-ok")
`;

// --- Blender MCP socket client --------------------------------------------------

export type BlenderMcpOptions = { host?: string; port?: number; timeoutMs?: number; tempDir?: string };

/**
 * Talks to the Blender MCP addon's TCP socket (default localhost:9876) using its
 * JSON protocol: {type, params} -> {status, result|message}. One connection per
 * command. Export/screenshot go through files, so Blender must share this
 * machine's filesystem.
 *
 * UNVERIFIED against a live Blender: written from the addon's published
 * protocol with no Blender available to test; see README before relying on it.
 */
export class BlenderMcpClient implements BlenderPort {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly tempDir: string;

  constructor(options: BlenderMcpOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 9876;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.tempDir = options.tempDir ?? tmpdir();
  }

  private command(type: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<{ status: string; result?: unknown; message?: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = "";
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); socket.destroy(); signal?.removeEventListener("abort", onAbort); fn(); } };
      const onAbort = () => finish(() => reject(new BlenderError("Aborted")));
      const timer = setTimeout(() => finish(() => reject(new BlenderError(`Blender did not respond within ${this.timeoutMs} ms`))), this.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.on("connect", () => socket.write(JSON.stringify({ type, params })));
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        try { const parsed = JSON.parse(buffer); finish(() => resolve(parsed)); } catch { /* wait for the rest of the message */ }
      });
      socket.on("error", (error) => finish(() => reject(new BlenderError(`Cannot reach Blender MCP at ${this.host}:${this.port} (${error.message}). Is Blender open with the addon connected?`))));
      socket.on("close", () => finish(() => reject(new BlenderError("Blender closed the connection without a complete response"))));
    });
  }

  async runPython(code: string, signal?: AbortSignal): Promise<PythonResult> {
    const response = await this.command("execute_code", { code }, signal);
    if (response.status === "success") {
      const result = response.result as { result?: unknown } | undefined;
      return { ok: true, output: String(result?.result ?? "") };
    }
    return { ok: false, output: String(response.message ?? "Blender reported an error") };
  }

  async screenshot(signal?: AbortSignal): Promise<Uint8Array | null> {
    const filepath = join(this.tempDir, `house-shot-${randomUUID()}.png`);
    try {
      const response = await this.command("get_viewport_screenshot", { max_size: 768, filepath, format: "png" }, signal);
      if (response.status !== "success") return null;
      return new Uint8Array(await readFile(filepath));
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    } finally {
      await unlink(filepath).catch(() => undefined);
    }
  }

  async exportGlb(signal?: AbortSignal): Promise<Uint8Array> {
    const path = join(this.tempDir, `house-export-${randomUUID()}.glb`);
    try {
      const result = await this.runPython(exportScript(path), signal);
      if (!result.ok) throw new BlenderError(`GLB export failed: ${result.output}`);
      return new Uint8Array(await readFile(path));
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  async reset(signal?: AbortSignal): Promise<void> {
    const result = await this.runPython(RESET_SCRIPT, signal);
    if (!result.ok) throw new BlenderError(`Could not reset the Blender scene: ${result.output}`);
  }
}

/** Blender is stateful, so each job gets exclusive use of one instance; extra jobs queue. */
export class BlenderPool {
  private idle: BlenderPort[];
  private waiters: ((port: BlenderPort) => void)[] = [];

  constructor(ports: BlenderPort[]) {
    if (ports.length === 0) throw new Error("BlenderPool needs at least one Blender");
    this.idle = [...ports];
  }

  private acquire(): Promise<BlenderPort> {
    const port = this.idle.pop();
    return port ? Promise.resolve(port) : new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(port: BlenderPort) {
    const next = this.waiters.shift();
    if (next) next(port); else this.idle.push(port);
  }

  async use<T>(fn: (port: BlenderPort) => Promise<T>): Promise<T> {
    const port = await this.acquire();
    try { return await fn(port); } finally { this.release(port); }
  }
}
