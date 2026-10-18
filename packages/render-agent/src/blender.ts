import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
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

/** The addon reports execute_code failures as a JSON string {exception_type, message, traceback}; make it readable. */
export function formatBlenderError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { exception_type?: string; message?: string; traceback?: string };
    if (parsed.exception_type) {
      const lines = (parsed.traceback ?? "").trim().split("\n");
      return `${parsed.exception_type}: ${parsed.message ?? ""}\n${lines.slice(-6).join("\n")}`.trim();
    }
  } catch { /* not structured; use as-is */ }
  return message;
}

/** What the agent needs from one running Blender. Implemented over the Blender MCP socket or by a test fake. */
export interface BlenderPort {
  /** Runs Python inside Blender. `output` is captured stdout, or the error text when !ok. */
  runPython(code: string, signal?: AbortSignal): Promise<PythonResult>;
  /** PNG of the 3D viewport, or null when unavailable (e.g. headless Blender). */
  screenshot(signal?: AbortSignal): Promise<Uint8Array | null>;
  /** Self-contained GLB of all mesh objects, Y-up, modifiers applied. */
  exportGlb(signal?: AbortSignal): Promise<Uint8Array>;
  /** Loads a GLB into the scene (Blender converts glTF Y-up to its Z-up) so it can be modified. */
  importGlb(glb: Uint8Array, signal?: AbortSignal): Promise<void>;
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
mats = []
seen = set()
for obj in bpy.data.objects:
    if obj.type != 'MESH' or obj.hide_viewport:
        continue
    for slot in obj.material_slots:
        m = slot.material
        if m is None or m.name in seen:
            continue
        seen.add(m.name)
        base, tex = None, False
        if m.use_nodes:
            bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is not None:
                socket = bsdf.inputs['Base Color']
                tex = bool(socket.is_linked)
                base = [round(v, 2) for v in socket.default_value[:3]]
        mats.append({"name": m.name, "base_color_linear_rgb": base, "texture_driven": tex})
if count == 0:
    print(json.dumps({"mesh_objects": 0}))
else:
    size = [mx[i] - mn[i] for i in range(3)]
    print(json.dumps({
        "mesh_objects": count, "names": names[:40], "triangles": tris,
        "blender_size_xyz": [round(s, 4) for s in size],
        "gltf_dims_width_height_depth": [round(size[0], 4), round(size[2], 4), round(size[1], 4)],
        "lowest_z": round(mn[2], 4),
        "materials": mats,
    }))
`;

/** Frames the model in a 3/4 view so a viewport screenshot actually shows it (GUI Blender only). */
export const FRAME_VIEW_SCRIPT = `
import bpy, math
from mathutils import Euler
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        region = next(r for r in area.regions if r.type == 'WINDOW')
        area.spaces.active.region_3d.view_rotation = Euler((math.radians(70), 0, math.radians(35))).to_quaternion()
        with bpy.context.temp_override(area=area, region=region):
            bpy.ops.view3d.view_all(center=True)
        break
`;

export const MESH_NAMES_SCRIPT = `
import bpy, json
print(json.dumps([o.name for o in bpy.data.objects if o.type == 'MESH' and not o.hide_viewport]))
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

/**
 * Imports a GLB and FLATTENS it: glTF assets arrive under a parent empty carrying the Y-up->Z-up rotation and
 * offsets, which makes editing painful (a model once spent ~10 rounds fighting parent transforms). After this
 * every mesh is a plain top-level object with an identity transform and world-space vertices; names are kept.
 */
export const importScript = (path: string) => `
import bpy
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(path)})
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    world = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = world
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
if meshes:
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.make_single_user(object=True, obdata=True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as e:
        print("flatten-warning:", e)
print("import-ok", len(meshes))
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
    return { ok: false, output: formatBlenderError(String(response.message ?? "Blender reported an error")) };
  }

  /** Cheap liveness check ({type:"ping"}); false when nothing answers on the port. */
  async ping(signal?: AbortSignal): Promise<boolean> {
    try { return (await this.command("ping", {}, signal)).status === "success"; } catch { return false; }
  }

  async screenshot(signal?: AbortSignal): Promise<Uint8Array | null> {
    const filepath = join(this.tempDir, `house-shot-${randomUUID()}.png`);
    try {
      await this.runPython(FRAME_VIEW_SCRIPT, signal).catch(() => undefined);
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
      // Prefer the addon's native export_scene command, limited to mesh objects (no cameras/lights);
      // an older addon or the headless server answers "Unknown command", so fall back to a script.
      const names = await this.runPython(MESH_NAMES_SCRIPT, signal);
      let exported = false;
      if (names.ok) {
        try {
          const meshNames = JSON.parse(names.output.trim().split("\n").pop() ?? "[]") as string[];
          if (meshNames.length) {
            const response = await this.command("export_scene", { filepath: path, format: "glb", object_names: meshNames, apply_modifiers: true }, signal);
            const result = response.result as { error?: string } | undefined;
            if (response.status === "success" && !result?.error) exported = true;
            else if (response.status === "error" && !/Unknown command/i.test(String(response.message))) throw new BlenderError(`GLB export failed: ${formatBlenderError(String(response.message))}`);
            else if (result?.error) throw new BlenderError(`GLB export failed: ${result.error}`);
          }
        } catch (error) { if (error instanceof BlenderError) throw error; /* unparseable names: use the script */ }
      }
      if (!exported) {
        const result = await this.runPython(exportScript(path), signal);
        if (!result.ok) throw new BlenderError(`GLB export failed: ${result.output}`);
      }
      return new Uint8Array(await readFile(path));
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  async importGlb(glb: Uint8Array, signal?: AbortSignal): Promise<void> {
    const path = join(this.tempDir, `house-import-${randomUUID()}.glb`);
    try {
      await writeFile(path, glb);
      const result = await this.runPython(importScript(path), signal);
      if (!result.ok) throw new BlenderError(`GLB import failed: ${result.output}`);
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

  /** Exclusive hold on one Blender until `release()`; use when a job needs it across several steps. */
  async lease(): Promise<{ port: BlenderPort; release: () => void }> {
    const port = await this.acquire();
    let released = false;
    return { port, release: () => { if (!released) { released = true; this.release(port); } } };
  }

  async use<T>(fn: (port: BlenderPort) => Promise<T>): Promise<T> {
    const { port, release } = await this.lease();
    try { return await fn(port); } finally { release(); }
  }
}
