import { useMemo, useSyncExternalStore } from 'react';
import { TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { SceneOp } from '@house/contracts';
import { classOf, moveWithSupport, transformsEqual, wallPose } from '@house/scene-engine';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { applyObjectTransform, worldTransformOf } from '../lib/convert';
import { commit, opContext, toast, useEditor } from '../state/store';
import { dragFeedback } from './dragFeedback';
import { interaction, registry } from './registry';

/** The live TransformControls instance (the pointer router checks `axis` to yield the drag to it). */
export const gizmo: { current: TransformControlsImpl | null } = { current: null };

/**
 * Precision gizmo (Move tool) for the primary selection. Translate on X/Z plus a Y handle for
 * lifting; wall items slide along their wall and vertically in local space. Rotation uses the
 * floor ring instead. On release: one move op; non-mounted items settle (gravity) unless Float.
 */
export function TransformControlsWrapper() {
  const selectedId = useEditor((s) => s.selectedId);
  const multi = useEditor((s) => s.selectedIds.length > 1);
  const mode = useEditor((s) => s.mode);
  const snapping = useEditor((s) => s.snapping);
  const walk = useEditor((s) => s.walkMode);
  const objects = useEditor((s) => s.workingScene?.objects);
  const shell = useEditor((s) => s.shell);
  const group = useSyncExternalStore(registry.subscribe, () => (selectedId ? registry.get(selectedId) : undefined));
  const obj = useMemo(() => objects?.find((o) => o.id === selectedId), [objects, selectedId]);
  const parent = useMemo(() => (obj?.placement?.parentId ? objects?.find((o) => o.id === obj.placement!.parentId) : undefined), [objects, obj]);
  const ctx = useMemo(() => (shell ? opContext() : null), [shell, objects]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!obj || !group || !ctx || obj.locked || mode !== 'translate' || multi || walk) return null;
  const cls = classOf(ctx, obj);

  const onMouseDown = () => useEditor.setState({ dragging: true });

  const onMouseUp = () => {
    interaction.lastDragEndAt = performance.now();
    dragFeedback.clear();
    useEditor.setState({ dragging: false });
    let t = worldTransformOf(group);
    if (cls === 'wall' && shell) {
      const pose = wallPose(shell, obj.dimensionsM, [t.position[0], t.position[2]], t.position[1] + obj.dimensionsM[1] / 2);
      if (pose) t = { position: pose.position, rotation: [0, Math.sin(pose.yaw / 2), 0, Math.cos(pose.yaw / 2)], scale: [1, 1, 1] };
    }
    if (transformsEqual(t, obj.transform, 1e-7)) return;
    const ops: SceneOp[] = cls === 'wall' || cls === 'ceiling'
      ? [{ type: 'move', objectId: obj.id, transform: t }]
      : moveWithSupport(ctx, { objects: objects! }, obj.id, t);
    const r = commit('Move', ops, { quiet: true });
    if (!r.ok) {
      applyObjectTransform(group, obj, parent);
      toast(r.error.reason === 'GEOMETRY' ? `Snapped back — ${r.error.message}` : r.error.message, 'warning');
    }
  };

  return (
    <TransformControls
      ref={(c) => { gizmo.current = c as unknown as TransformControlsImpl | null; }}
      object={group}
      mode="translate"
      space={cls === 'wall' ? 'local' : 'world'}
      size={0.9}
      showX
      showY
      showZ={cls !== 'wall'}
      translationSnap={snapping ? EDITOR_POLICY.snap.translateM : null}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    />
  );
}
