import type { SceneOp, SceneSpec } from "@house/contracts";

export type OpSource = "user" | "undo" | "redo";

export interface OpLogEntry {
  id: string;
  at: string;
  source: OpSource;
  op: SceneOp;
  summary: string;
}

function nameOf(scene: SceneSpec, objectId: string): string {
  return scene.objects.find((o) => o.id === objectId)?.displayName ?? objectId.slice(0, 8);
}

function fmtVec3(v: readonly [number, number, number]): string {
  return `(${v.map((n) => n.toFixed(2)).join(", ")})`;
}

/**
 * Human-readable one-liner for an applied SceneOp, built from the scene
 * state *before* the op was applied (so deletes/moves can still name the
 * object). This is the same op every caller — gizmo drag, coordinates
 * popup, or eventually an agent planner — produces; the log exists to make
 * that visible, not to special-case any one caller.
 */
export function summarizeOp(sceneBefore: SceneSpec, op: SceneOp): string {
  switch (op.type) {
    case "add":
      return `Add ${op.object.displayName} at ${fmtVec3(op.object.transform.position)}`;
    case "delete":
      return `Delete ${nameOf(sceneBefore, op.objectId)}`;
    case "move":
      return `Move ${nameOf(sceneBefore, op.objectId)} -> ${fmtVec3(op.transform.position)}`;
    case "replaceAsset":
      return `Replace asset on ${nameOf(sceneBefore, op.objectId)} -> ${op.assetId.slice(0, 8)}`;
    case "replacePhysicalItem":
      return `Replace ${nameOf(sceneBefore, op.oldObjectId)} with ${op.newObject.displayName}`;
    case "changeMaterial":
      return `Change material on ${nameOf(sceneBefore, op.objectId)}`;
    case "setLock":
      return `${op.locked ? "Lock" : "Unlock"} ${nameOf(sceneBefore, op.objectId)}`;
  }
}

export function makeLogEntry(sceneBefore: SceneSpec, op: SceneOp, source: OpSource): OpLogEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source,
    op,
    summary: summarizeOp(sceneBefore, op),
  };
}
