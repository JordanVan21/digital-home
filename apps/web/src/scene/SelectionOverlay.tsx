import { labelLayer } from './labelLayer';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BoxGeometry, BufferGeometry, EdgesGeometry, Float32BufferAttribute, Quaternion, Vector3, type Group, type LineBasicMaterial, type PointsMaterial } from 'three';
import type { SceneObject } from '@house/contracts';
import { effectiveDimsOf, shapeOfAsset } from '@house/scene-engine';
import { useEditor } from '../state/store';
import { dragFeedback } from './dragFeedback';
import { registry } from './registry';
import { outlineSizeOf, shapeOutlineGeometry } from './shapeOutline';

const COLORS = { hover: '#f4f1ea', selected: '#8a8dff', invalid: '#ff5a52', warning: '#ffb547' };

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _f = new Vector3();

/**
 * 'blocker' outlines are no longer drawn on obstacles: while dragging, only the piece you hold is
 * outlined (red when blocked, with a "hits …" label), so the selection never appears to jump to
 * another piece. Contact guides show where they touch.
 */
type Kind = 'hover' | 'selected' | 'all';

/**
 * Highlight overlay that follows the object's live group transform each frame (tracks drags without
 * store writes; furniture materials are never touched). The outline is the model's baked shape
 * (codex's shape-hugging outline), sized exactly as the model is drawn; models without a baked shape
 * (proxies, alpha-tested plants, tilted decor) get jordan's box. Corner dots and the footprint loop
 * mark the bounds. Drawing only — collision never reads these shapes.
 */
function ObjectOutline({ obj, kind, primary }: { obj: SceneObject; kind: Kind; primary?: boolean }) {
  const ref = useRef<Group>(null);
  const boxMat = useRef<LineBasicMaterial>(null);
  const footMat = useRef<LineBasicMaterial>(null);
  const dotMat = useRef<PointsMaterial>(null);
  const committed = useEditor((s) => s.violations[obj.id]);
  const asset = useEditor((s) => (obj.assetId ? s.catalog?.get(obj.assetId) : undefined));
  const tilted = !!obj.tilt && (obj.tilt.x !== 0 || obj.tilt.z !== 0);
  const shape = tilted ? null : shapeOfAsset(asset);
  const eff = effectiveDimsOf(obj);
  const [w, h, d] = shape && asset ? outlineSizeOf(asset.dimensionsM, obj.dimensionsM) : eff;
  const pad = shape ? 0 : 0.015;
  const lines = useMemo(
    () => (shape ? shapeOutlineGeometry(shape, [w, h, d]) : new EdgesGeometry(new BoxGeometry(w + pad, h + pad, d + pad)).translate(0, h / 2, 0)),
    [shape, w, h, d, pad],
  );
  useEffect(() => () => lines.dispose(), [lines]);
  const footprint = useMemo(() => {
    const g = new BufferGeometry();
    const x = w / 2 + 0.04;
    const z = d / 2 + 0.04;
    g.setAttribute('position', new Float32BufferAttribute([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], 3));
    return g;
  }, [w, d]);
  const dots = useMemo(() => {
    const g = new BufferGeometry();
    const x = (w + pad) / 2;
    const z = (d + pad) / 2;
    const pts: number[] = [];
    for (const yy of [0, h + pad]) for (const [a, b] of [[-x, -z], [x, -z], [x, z], [-x, z]]) pts.push(a!, yy - pad / 2, b!);
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    return g;
  }, [w, h, d, pad]);

  useFrame(() => {
    const grp = registry.get(obj.id);
    const o = ref.current;
    if (!grp || !o) return;
    grp.updateWorldMatrix(true, false);
    grp.matrixWorld.decompose(_p, _q, _s);
    _f.set(0, 0, 1).applyQuaternion(_q);
    o.position.copy(_p);
    o.rotation.set(0, Math.atan2(_f.x, _f.z), 0);
    let color: string = kind === 'all' ? COLORS.selected : COLORS[kind];
    if (kind === 'selected') {
      const live = dragFeedback.objectId === obj.id;
      if (live && (dragFeedback.blockers.length || dragFeedback.violations.length)) color = COLORS.invalid;
      else if (!live && committed?.some((v) => v.severity === 'error')) color = COLORS.invalid;
      else if (!live && committed?.length) color = COLORS.warning;
    }
    boxMat.current?.color.set(color);
    footMat.current?.color.set(color);
    dotMat.current?.color.set(color);
  });

  const quiet = kind === 'hover' || kind === 'all';
  return (
    <group ref={ref} renderOrder={10}>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial ref={boxMat} transparent opacity={kind === 'all' ? 0.4 : kind === 'hover' ? 0.6 : 0.95} depthTest={false} />
      </lineSegments>
      {kind !== 'all' && (
        <lineLoop geometry={footprint} position={[0, 0.006, 0]} raycast={() => null}>
          <lineBasicMaterial ref={footMat} transparent opacity={kind === 'hover' ? 0.5 : 1} depthTest={false} />
        </lineLoop>
      )}
      {!quiet && (
        <points geometry={dots} raycast={() => null}>
          <pointsMaterial ref={dotMat} size={7} sizeAttenuation={false} depthTest={false} transparent />
        </points>
      )}
      {primary && <DragLabel id={obj.id} height={h} />}
    </group>
  );
}

function DragLabel({ id, height }: { id: string; height: number }) {
  const sig = useSyncExternalStore(dragFeedback.subscribe.bind(dragFeedback), () => dragFeedback.signature);
  if (!sig || dragFeedback.objectId !== id) return null;
  const msgs = [...new Set([
    ...dragFeedback.blockers.map((b) => (b.wall ? 'hits the wall' : `hits ${b.label}`)),
    ...dragFeedback.violations.map((v) => v.detail),
  ])].slice(0, 2);
  if (!msgs.length) return null;
  const isError = dragFeedback.violations.some((v) => v.severity === 'error');
  return (
    <Html portal={labelLayer} position={[0, height + 0.2, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`violation-label ${isError ? 'error' : ''}`}>{msgs.join(' · ')}</div>
    </Html>
  );
}

/** Lock / warning badges for every object that is locked or flagged. */
function Badges() {
  const objects = useEditor((s) => s.workingScene?.objects);
  const violations = useEditor((s) => s.violations);
  const selected = useEditor((s) => s.selectedIds);
  const flagged = useMemo(() => objects?.filter((o) => o.locked || (violations[o.id]?.length && !selected.includes(o.id))) ?? [], [objects, violations, selected]);
  return <>{flagged.map((o) => <BadgeFor key={o.id} obj={o} flagged={!!violations[o.id]?.length} />)}</>;
}

function BadgeFor({ obj, flagged }: { obj: SceneObject; flagged: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const grp = registry.get(obj.id);
    if (!grp || !ref.current) return;
    grp.getWorldPosition(ref.current.position);
  });
  return (
    <group ref={ref}>
      <Html portal={labelLayer} position={[0, effectiveDimsOf(obj)[1] + 0.08, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <div className="badges">
          {obj.locked && <span className="badge lock" title="Locked"><LockGlyph /></span>}
          {flagged && <span className="badge warn" title="Has placement warnings">!</span>}
        </div>
      </Html>
    </group>
  );
}

export function LockGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
      <rect x="1" y="5" width="9" height="6.5" rx="1.4" fill="currentColor" />
      <path d={open ? 'M3 5V3.4a2.5 2.5 0 0 1 5-.6' : 'M3 5V3.5a2.5 2.5 0 0 1 5 0V5'} stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

export function SelectionOverlay() {
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.workingScene?.objects);
  const hoveredId = useEditor((s) => s.hoveredId);
  const walk = useEditor((s) => s.walkMode);
  const selected = useMemo(() => objects?.filter((o) => selectedIds.includes(o.id)) ?? [], [objects, selectedIds]);
  const hovered = useMemo(() => (hoveredId && !selectedIds.includes(hoveredId) ? objects?.find((o) => o.id === hoveredId) : undefined), [objects, hoveredId, selectedIds]);
  const primaryId = selectedIds[selectedIds.length - 1];
  const showAll = useEditor((s) => s.showAllOutlines);
  if (walk) return null;
  return (
    <group name="selection-overlay">
      {showAll && objects?.filter((o) => !selectedIds.includes(o.id) && o.id !== hovered?.id).map((o) => <ObjectOutline key={`a-${o.id}`} obj={o} kind="all" />)}
      {hovered && <ObjectOutline key={`h-${hovered.id}`} obj={hovered} kind="hover" />}
      {selected.map((o) => <ObjectOutline key={`s-${o.id}`} obj={o} kind="selected" primary={o.id === primaryId} />)}
      <Badges />
    </group>
  );
}
