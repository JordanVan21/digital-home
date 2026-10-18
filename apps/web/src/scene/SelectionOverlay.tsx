import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, Float32BufferAttribute, Quaternion, Shape, ShapeGeometry, Vector3, type Group, type LineBasicMaterial, type MeshBasicMaterial } from 'three';
import type { SceneObject } from '@house/contracts';
import { effectiveDimsOf, localBoxes } from '@house/scene-engine';
import { compoundExteriorPositions } from './compoundOutline';
import { useEditor } from '../state/store';
import { ObjectToolbar } from '../ui/ObjectToolbar';
import { dragFeedback } from './dragFeedback';
import { registry } from './registry';

const COLORS = { hover: '#ffffff', selected: '#9187ff', invalid: '#e36856', warning: '#e0a43a', resolved: '#6fcf97' };

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _f = new Vector3();

type Kind = 'hover' | 'selected' | 'blocker' | 'conflict' | 'resolved';

/** Rounded-rectangle outline (XZ, centred) as a closed shape. */
function roundedRect(w: number, d: number, r: number): Shape {
  const x = w / 2;
  const z = d / 2;
  const k = Math.min(r, x, z);
  const sh = new Shape();
  sh.moveTo(-x + k, -z);
  sh.lineTo(x - k, -z);
  sh.quadraticCurveTo(x, -z, x, -z + k);
  sh.lineTo(x, z - k);
  sh.quadraticCurveTo(x, z, x - k, z);
  sh.lineTo(-x + k, z);
  sh.quadraticCurveTo(-x, z, -x, z - k);
  sh.lineTo(-x, -z + k);
  sh.quadraticCurveTo(-x, -z, -x + k, -z);
  return sh;
}

/**
 * Selection cue in the codex style: no boxes around the model — a soft rounded glow on the floor
 * under the piece (violet selected, red conflict, green resolved; hover is a faint edge). Built from
 * scene-engine (tilted) dimensions and following the live group transform each frame, so it tracks
 * drags without store writes. Furniture materials are never touched.
 */
function ObjectOutline({ obj, kind }: { obj: SceneObject; kind: Kind }) {
  const ref = useRef<Group>(null);
  const fillMat = useRef<MeshBasicMaterial>(null);
  const edgeMat = useRef<LineBasicMaterial>(null);
  const committed = useEditor((s) => s.violations[obj.id]);
  const conflict = useEditor((s) => !!s.draft.conflicts[obj.id]);
  const resolved = useEditor((s) => s.draft.resolved.includes(obj.id));
  const [w, , d] = effectiveDimsOf(obj);
  const pad = 0.06;
  const { fill, edge } = useMemo(() => {
    const shape = roundedRect(w + pad * 2, d + pad * 2, 0.08);
    const pts = shape.getPoints(6).map((p) => new Vector3(p.x, 0, p.y));
    return { fill: new ShapeGeometry(shape, 6).rotateX(Math.PI / 2), edge: new BufferGeometry().setFromPoints(pts) };
  }, [w, d]);
  useEffect(() => () => { fill.dispose(); edge.dispose(); }, [fill, edge]);

  useFrame(() => {
    const grp = registry.get(obj.id);
    const o = ref.current;
    if (!grp || !o) return;
    grp.updateWorldMatrix(true, false);
    grp.matrixWorld.decompose(_p, _q, _s);
    _f.set(0, 0, 1).applyQuaternion(_q);
    o.position.set(_p.x, _p.y + 0.006, _p.z);
    o.rotation.set(0, Math.atan2(_f.x, _f.z), 0);
    let color: string = kind === 'blocker' || kind === 'conflict' ? COLORS.invalid : COLORS[kind];
    if (kind === 'selected') {
      const live = dragFeedback.objectId === obj.id;
      if (live && dragFeedback.violations.length) color = COLORS.invalid;
      else if (!live && conflict) color = COLORS.invalid;
      else if (!live && resolved) color = COLORS.resolved;
      else if (!live && committed?.some((v) => v.severity === 'error')) color = COLORS.invalid;
    }
    fillMat.current?.color.set(color);
    edgeMat.current?.color.set(color);
  });

  const fillOpacity = kind === 'hover' ? 0 : kind === 'selected' ? 0.24 : 0.18;
  return (
    <group ref={ref} renderOrder={10}>
      {fillOpacity > 0 && (
        <mesh geometry={fill} raycast={() => null} renderOrder={10}>
          <meshBasicMaterial ref={fillMat} transparent opacity={fillOpacity} depthTest={false} depthWrite={false} />
        </mesh>
      )}
      <lineLoop geometry={edge} raycast={() => null} renderOrder={11}>
        <lineBasicMaterial ref={edgeMat} transparent opacity={kind === 'hover' ? 0.45 : 0.85} depthTest={false} />
      </lineLoop>
    </group>
  );
}

/** Lock / new / warning badges for pieces that are locked, newly suggested or flagged. */
function Badges() {
  const objects = useEditor((s) => s.workingScene?.objects);
  const accepted = useEditor((s) => s.acceptedScene);
  const violations = useEditor((s) => s.violations);
  const conflicts = useEditor((s) => s.draft.conflicts);
  const selected = useEditor((s) => s.selectedIds);
  const added = useMemo(() => {
    const ids = new Set(accepted?.objects.map((o) => o.id));
    return new Set(objects?.filter((o) => !ids.has(o.id)).map((o) => o.id));
  }, [objects, accepted]);
  const flaggedOf = (id: string) => !conflicts[id] && !!violations[id]?.length;
  const shown = useMemo(
    () => objects?.filter((o) => !selected.includes(o.id) && (o.locked || added.has(o.id) || flaggedOf(o.id))) ?? [],
    [objects, violations, conflicts, selected, added], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <>{shown.map((o) => <BadgeFor key={o.id} obj={o} flagged={flaggedOf(o.id)} isNew={added.has(o.id)} />)}</>;
}

function BadgeFor({ obj, flagged, isNew }: { obj: SceneObject; flagged: boolean; isNew: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const grp = registry.get(obj.id);
    if (!grp || !ref.current) return;
    grp.getWorldPosition(ref.current.position);
  });
  return (
    <group ref={ref}>
      <Html position={[0, effectiveDimsOf(obj)[1] + 0.08, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <div className="badges">
          {obj.locked && <span className="badge lock" title="Locked"><LockGlyph /> Locked</span>}
          {isNew && <span className="badge new">New</span>}
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

function Blockers() {
  useSyncExternalStore(dragFeedback.subscribe.bind(dragFeedback), () => dragFeedback.signature);
  const objects = useEditor.getState().workingScene?.objects;
  const ids = new Set(dragFeedback.violations.filter((v) => v.otherId).map((v) => v.otherId!));
  return <>{objects?.filter((o) => ids.has(o.id)).map((o) => <ObjectOutline key={`b-${o.id}`} obj={o} kind="blocker" />)}</>;
}

/** Conflicting suggestions stay outlined red; pieces Accept moved to fit pulse green briefly. */
function DraftOutlines({ exclude }: { exclude: readonly string[] }) {
  const objects = useEditor((s) => s.workingScene?.objects);
  const conflicts = useEditor((s) => s.draft.conflicts);
  const resolved = useEditor((s) => s.draft.resolved);
  const dragging = useEditor((s) => s.dragging);
  const list = useMemo(
    () => objects?.filter((o) => !exclude.includes(o.id) && (conflicts[o.id] || resolved.includes(o.id))) ?? [],
    [objects, conflicts, resolved, exclude],
  );
  if (dragging) return null;
  return <>{list.map((o) => <ObjectOutline key={`d-${o.id}`} obj={o} kind={conflicts[o.id] ? 'conflict' : 'resolved'} />)}</>;
}

/** One piece's collision shape: the exterior of its compound boxes, following its live group. */
function ColliderOutline({ obj }: { obj: SceneObject }) {
  const ref = useRef<Group>(null);
  const catalog = useEditor((s) => s.catalog);
  const conflict = useEditor((s) => !!s.draft.conflicts[obj.id]);
  const lines = useMemo(() => {
    const { boxes } = localBoxes(obj, catalog ? (id) => catalog.get(id) : undefined);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(compoundExteriorPositions(boxes.map((b) => [b.min, b.max])).slice(), 3));
    return g;
  }, [obj, catalog]);
  useEffect(() => () => lines.dispose(), [lines]);
  useFrame(() => {
    const grp = registry.get(obj.id);
    const o = ref.current;
    if (!grp || !o) return;
    grp.updateWorldMatrix(true, false);
    grp.matrixWorld.decompose(_p, _q, _s);
    _f.set(0, 0, 1).applyQuaternion(_q);
    o.position.copy(_p);
    o.rotation.set(0, Math.atan2(_f.x, _f.z), 0);
  });
  return (
    <group ref={ref}>
      <lineSegments geometry={lines} raycast={() => null} renderOrder={9}>
        <lineBasicMaterial color={conflict ? COLORS.invalid : COLORS.selected} transparent opacity={0.7} depthTest={false} />
      </lineSegments>
    </group>
  );
}

function ColliderOutlines() {
  const on = useEditor((s) => s.showColliders);
  const objects = useEditor((s) => s.workingScene?.objects);
  if (!on || !objects) return null;
  return <>{objects.map((o) => <ColliderOutline key={`c-${o.id}`} obj={o} />)}</>;
}

/** The glass tool pill above the primary selection; follows its group live (drags, glides). */
function ToolbarAnchor({ obj }: { obj: SceneObject }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const grp = registry.get(obj.id);
    if (!grp || !ref.current) return;
    grp.getWorldPosition(ref.current.position);
  });
  return (
    <group ref={ref}>
      <Html position={[0, effectiveDimsOf(obj)[1] + 0.32, 0]} center zIndexRange={[30, 0]}>
        <ObjectToolbar object={obj} />
      </Html>
    </group>
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
  const primary = selected.find((o) => o.id === primaryId);
  if (walk) return null;
  return (
    <group name="selection-overlay">
      {hovered && <ObjectOutline key={`h-${hovered.id}`} obj={hovered} kind="hover" />}
      {selected.map((o) => <ObjectOutline key={`s-${o.id}`} obj={o} kind="selected" />)}
      <Blockers />
      <DraftOutlines exclude={selectedIds} />
      <ColliderOutlines />
      <Badges />
      {primary && <ToolbarAnchor key={`t-${primary.id}`} obj={primary} />}
    </group>
  );
}
