/**
 * Best-effort screen for model-written Blender Python before it reaches
 * Blender's execute_code. THIS IS NOT A SANDBOX: it blocks the obvious ways to
 * touch the filesystem, network, processes or Blender's own persistence, and
 * keeps scripts to modeling work. Run Blender as a low-privilege user anyway.
 */
const ALLOWED_MODULES = new Set(["bpy", "bmesh", "mathutils", "math", "random", "colorsys", "itertools", "json"]);
const MAX_CODE_CHARS = 20_000;

const FORBIDDEN: [RegExp, string][] = [
  [/__/, "double-underscore names (e.g. __import__, __builtins__) are not allowed"],
  [/\b(eval|exec|compile|open|input|breakpoint|globals|locals|vars|getattr|setattr|delattr)\s*\(/, "this builtin is not allowed"],
  [/\b(os|sys|subprocess|socket|shutil|pathlib|importlib|builtins|ctypes|requests|urllib|http|ftplib|pickle|marshal)\b/, "system/network modules are not allowed"],
  [/bpy\.ops\.(wm|script|preferences|render|screen|sequencer|file|outliner|export_\w+|import_\w+)\b/, "this bpy.ops namespace is not allowed (export is done by submit_asset)"],
  [/bpy\.(app|utils|path|context\.preferences|data\.libraries|data\.texts|data\.filepath)\b/, "this bpy API is not allowed"],
  [/\bsave_as_mainfile|save_mainfile|load_factory|\.filepath\s*=|\bfilepath\s*=/, "writing or loading files is not allowed"],
];

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkBpyCode(code: string): GuardResult {
  if (code.trim().length === 0) return { ok: false, reason: "Code is empty." };
  if (code.length > MAX_CODE_CHARS) return { ok: false, reason: `Code is longer than ${MAX_CODE_CHARS} characters; split it into steps.` };
  for (const match of code.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.,\s]+?)(?:\s+as\s+\w+)?\s*$)/gm)) {
    const modules = match[1] ? [match[1]] : match[2].split(",").map((m) => m.trim().split(/\s+as\s+/)[0]);
    for (const mod of modules) {
      const top = mod.split(".")[0];
      if (!ALLOWED_MODULES.has(top)) return { ok: false, reason: `Importing '${top}' is not allowed. Allowed: ${[...ALLOWED_MODULES].join(", ")}.` };
    }
  }
  for (const [pattern, reason] of FORBIDDEN) {
    const hit = pattern.exec(code);
    if (hit) return { ok: false, reason: `Blocked '${hit[0]}': ${reason}.` };
  }
  return { ok: true };
}
