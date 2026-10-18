import type { SceneOp, SceneSpec, Vec3 } from '@house/contracts';
import { yawFromQuat } from '@house/scene-engine';

/**
 * Schema-first edit log (from the original sandbox): every mutation, from any caller — drag,
 * inspector fields, keyboard, library, or eventually an agent — is a list of typed contract ops.
 * The log makes that visible: a suggestion records the ops applied to the draft, an Accept
 * records the resolved ScenePatch that is saved.
 */
export type OpSource = 'suggest' | 'accept' | 'immediate' | 'undo' | 'redo' | 'discard' | 'revert';

export interface OpLogEntry {
  id: string;
  at: string;
  source: OpSource;
  ops: SceneOp[];
  summary: string;
}

const fmt = (v: Vec3) => `(${v.map((n) => n.toFixed(2)).join(', ')})`;

function nameOf(scene: SceneSpec | null, id: string): string {
  return scene?.objects.find((o) => o.id === id)?.displayName ?? id.slice(0, 8);
}

/** One-liner for an op, named from the scene before it applied (so deletes can still be named). */
export function summarizeOp(before: SceneSpec | null, op: SceneOp): string {
  switch (op.type) {
    case 'add': return `Add ${op.object.displayName} at ${fmt(op.object.transform.position)}`;
    case 'delete': return `Delete ${nameOf(before, op.objectId)}`;
    case 'move': {
      const deg = Math.round((yawFromQuat(op.transform.rotation) * 180) / Math.PI);
      return `Move ${nameOf(before, op.objectId)} → ${fmt(op.transform.position)} · ${deg}°`;
    }
    case 'replaceAsset': return `Swap model of ${nameOf(before, op.objectId)}`;
    case 'replacePhysicalItem': return `Replace ${nameOf(before, op.oldObjectId)} with ${op.newObject.displayName}`;
    case 'changeMaterial': return `Change finish of ${nameOf(before, op.objectId)}`;
    case 'setLock': return `${op.locked ? 'Lock' : 'Unlock'} ${nameOf(before, op.objectId)}`;
    case 'setPlacement': return `${nameOf(before, op.objectId)} rests on ${op.placement.parentId ? nameOf(before, op.placement.parentId) : op.placement.support}${op.placement.float ? ' (float)' : ''}`;
    case 'resize': return `Resize ${nameOf(before, op.objectId)} → ${op.dimensionsM.map((n) => Math.round(n * 100)).join(' × ')} cm`;
    case 'setTilt': return `Tilt ${nameOf(before, op.objectId)}`;
    case 'setGroup': return `${op.groupId ? 'Group' : 'Ungroup'} ${op.objectIds.length} item${op.objectIds.length === 1 ? '' : 's'}`;
    case 'setLight': return `Light ${op.on ? 'on' : 'off'}: ${nameOf(before, op.objectId)}`;
    case 'setSceneSettings': return `Room settings${op.lightingPreset ? ` · lighting ${op.lightingPreset}` : ''}${op.appearance ? ' · finishes' : ''}`;
    case 'setRenovationDecision': return `Plan ${nameOf(before, op.objectId)}: ${op.decision ?? 'undecided'}`;
  }
}

export function makeLogEntry(source: OpSource, before: SceneSpec | null, ops: SceneOp[], note?: string): OpLogEntry {
  const first = ops[0];
  const summary = note ?? (first ? summarizeOp(before, first) + (ops.length > 1 ? ` (+${ops.length - 1} op${ops.length > 2 ? 's' : ''})` : '') : source);
  return { id: crypto.randomUUID(), at: new Date().toISOString(), source, ops, summary };
}
