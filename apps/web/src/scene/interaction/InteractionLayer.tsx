import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3, type Group, type Mesh, type Object3D, type Raycaster } from 'three';
import type { Vec3 } from '@house/contracts';
import { classOf, effectiveDimsOf, obbOf, rootsOf, selectionPivot } from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import { focusCamera, objectById, opContext, select, selectMany, toast, useEditor } from '../../state/store';
import { dragFeedback } from '../dragFeedback';
import { interaction, registry } from '../registry';
import { boxSelect } from './boxSelect';
import { hitPlaneY, modsOf, MoveSession, RotateSession, setRay, type DragSession, type Host } from './sessions';

export const SELECT_COLOR = '#9187ff';

type Controls = { enabled: boolean } | null;

function objectAt(r: Raycaster, root: Object3D | undefined): string | null {
  if (!root) return null;
  for (const hit of r.intersectObject(root, true)) {
    let o: Object3D | null = hit.object;
    if (!o.visible) continue;
    while (o && !o.userData.objectId) o = o.parent;
    if (o) return o.userData.objectId as string;
  }
  return null;
}

/**
 * Pointer routing for the canvas. A capture-phase listener runs before the camera controls see the
 * event, so a press on furniture or the swivel ring turns orbiting off for that drag:
 * - press + drag on an unlocked object → move it (Space / height tool = up/down; Alt = no snapping;
 *   Shift = 10 cm grid). In the rotate tool, dragging the selection or inside its ring swivels it;
 * - Shift+drag on empty space → box select;
 * - click (< 4 px) → select (Shift adds, Alt picks one member of a group); empty click deselects;
 * - double-click → focus the camera on the object / floor point. Locked objects just orbit.
 */
export function InteractionLayer() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as unknown as Controls;
  const setEvents = useThree((s) => s.setEvents);
  const ring = useRef<Mesh>(null);

  useEffect(() => {
    const el = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const host: Host = { camera, dom: gl.domElement };
    const setControls = (on: boolean) => {
      if (controls && !useEditor.getState().walkMode) controls.enabled = on;
    };
    // R3F hover raycasting is paused while dragging (the drag does its own targeted raycasts).
    const setHover = (on: boolean) => setEvents({ enabled: on });
    let press: {
      id: string | null; x: number; y: number; down: PointerEvent; box: boolean; draggable: boolean; locked: boolean; session: DragSession | null;
    } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!press) return;
      if (!press.session && !(press.box && boxSelect.get())) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < EDITOR_POLICY.clickMaxDeltaPx) return;
        if (press.id && press.locked) {
          toast(`${objectById(press.id)?.displayName ?? 'It'} is locked. Unlock it to move it.`, 'info', 2000);
          press.locked = false;
          return;
        }
        if (press.id && press.draggable) {
          const st = useEditor.getState();
          const inSel = st.selectedIds.includes(press.id);
          if (!inSel) select(press.id);
          const ids = useEditor.getState().selectedIds;
          const s = new MoveSession(host, press.down, ids, press.id, modsOf(press.down));
          if (!s.ok) { setControls(true); press.draggable = false; return; }
          press.session = s;
          setHover(false);
        } else if (press.box) {
          boxSelect.set({ x0: press.x, y0: press.y, x1: e.clientX, y1: e.clientY });
          return;
        } else return;
      }
      if (press.session) press.session.move(e);
      else if (press.box) boxSelect.set({ x0: press.x, y0: press.y, x1: e.clientX, y1: e.clientY });
    };

    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      press = null;
      setControls(true);
      setHover(true);
    };

    const onUp = (e: PointerEvent) => {
      if (!press) return;
      const p = press;
      if (p.session) p.session.up(e);
      else if (p.box && boxSelect.get()) {
        const r = boxSelect.get()!;
        boxSelect.set(null);
        selectMany(objectsInRect(r, host), true);
      } else if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < EDITOR_POLICY.clickMaxDeltaPx) {
        if (p.id) select(p.id, { additive: e.shiftKey, single: e.altKey });
        else if (!e.shiftKey && performance.now() - interaction.lastDragEndAt > EDITOR_POLICY.pointerMissedIgnoreMs) select(null);
      }
      end();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press?.session) {
        press.session.cancel();
        end();
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || useEditor.getState().walkMode || press) return;
      const r = setRay(host, e);
      const st = useEditor.getState();
      const id = objectAt(r, scene.getObjectByName('scene-objects'));
      const target = id ? objectById(id) : undefined;
      const onRing = !!ring.current?.visible && r.intersectObject(ring.current, false).length > 0;
      if (st.mode === 'rotate' && (onRing || (target && !target.locked))) {
        if (!onRing && id && !st.selectedIds.includes(id)) select(id);
        const s = new RotateSession(host, e);
        if (!s.ok) return;
        setControls(false);
        setHover(false);
        press = { id: null, x: e.clientX, y: e.clientY, down: e, box: false, draggable: false, locked: false, session: s };
      } else {
        const obj = target;
        const draggable = !!obj && !obj.locked;
        const box = !id && e.shiftKey;
        if (draggable || box) setControls(false);
        press = { id, x: e.clientX, y: e.clientY, down: e, box, draggable, locked: !!obj?.locked, session: null };
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
    };

    const onDbl = (e: MouseEvent) => {
      if (useEditor.getState().walkMode) return;
      const r = setRay(host, e);
      const id = objectAt(r, scene.getObjectByName('scene-objects'));
      const obj = id ? objectById(id) : undefined;
      if (obj) {
        const [x, y, z] = obj.transform.position;
        focusCamera([x, y + effectiveDimsOf(obj)[1] / 2, z]);
      } else {
        const h = hitPlaneY(r, useEditor.getState().shell?.floor.elevationY ?? 0);
        if (h) focusCamera([h.x, h.y, h.z]);
      }
    };

    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, scene, controls, setEvents]);

  return (
    <>
      <RotationRing meshRef={ring} />
      <HeightGuide />
      <Guides />
    </>
  );
}

function objectsInRect(r: { x0: number; y0: number; x1: number; y1: number }, host: Host): string[] {
  const s = useEditor.getState();
  const rect = host.dom.getBoundingClientRect();
  const [xa, xb] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
  const [ya, yb] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
  const v = new Vector3();
  return (s.workingScene?.objects ?? []).filter((o) => {
    const [x, y, z] = o.transform.position;
    v.set(x, y + effectiveDimsOf(o)[1] / 2, z).project(host.camera);
    const sx = rect.left + ((v.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - v.y) / 2) * rect.height;
    return v.z < 1 && sx >= xa && sx <= xb && sy >= ya && sy <= yb;
  }).map((o) => o.id);
}

/**
 * Swivel ring (rotate tool): a thin ring around the selection with a handle at the primary piece's
 * front (+Z). Its disk is the hit area; dragging inside it (or on the selection) swivels freely.
 * It follows the piece live while it's dragged or turned.
 */
function RotationRing({ meshRef }: { meshRef: React.RefObject<Mesh> }) {
  const sel = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.workingScene?.objects);
  const mode = useEditor((s) => s.mode);
  const walk = useEditor((s) => s.walkMode);
  const dragging = useEditor((s) => s.dragging);
  const roots = useMemo(() => {
    const ctx = opContext();
    if (!objects || !ctx) return [];
    return rootsOf({ objects }, sel).filter((o) => !o.locked && classOf(ctx, o) !== 'wall');
  }, [objects, sel]);
  const geom = useMemo(() => {
    if (!roots.length || !objects) return null;
    const pivot = roots.length === 1 ? [roots[0]!.transform.position[0], roots[0]!.transform.position[2]] : selectionPivot({ objects }, roots.map((r) => r.id));
    let radius = 0;
    for (const r of roots) {
      const b = obbOf(r);
      radius = Math.max(radius, Math.hypot(b.center[0] - pivot[0]!, b.center[1] - pivot[1]!) + Math.hypot(b.halfW, b.halfD));
    }
    return { pivot: pivot as [number, number], y: Math.min(...roots.map((r) => r.transform.position[1])) + 0.02, radius: radius + 0.15 };
  }, [roots, objects]);
  const group = useRef<Group>(null);
  const tmp = useMemo(() => ({ p: new Vector3(), q: new Quaternion(), f: new Vector3() }), []);

  useFrame(() => {
    const g = group.current;
    const primary = roots[roots.length - 1];
    if (!g || !geom || !primary) return;
    const live = registry.get(primary.id);
    if (!live) return;
    // A single piece's ring follows it; the handle stays at the primary piece's front.
    live.getWorldQuaternion(tmp.q);
    tmp.f.set(0, 0, 1).applyQuaternion(tmp.q);
    g.rotation.set(0, Math.atan2(tmp.f.x, tmp.f.z), 0);
    if (roots.length === 1) {
      live.getWorldPosition(tmp.p);
      g.position.set(tmp.p.x, tmp.p.y + 0.02, tmp.p.z);
    }
  });

  if (!geom || walk || mode !== 'rotate') return null;
  const active = dragging;
  return (
    <group ref={group} position={[geom.pivot[0], geom.y, geom.pivot[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={20}>
        <torusGeometry args={[geom.radius, 0.008, 6, 128]} />
        <meshBasicMaterial color={SELECT_COLOR} transparent opacity={active ? 0.95 : 0.7} depthTest={false} />
      </mesh>
      {/* Full-disk hit area. */}
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <circleGeometry args={[geom.radius, 64]} />
        <meshBasicMaterial color={SELECT_COLOR} transparent opacity={active ? 0.06 : 0.03} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, geom.radius]} renderOrder={21} raycast={() => null}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, geom.radius]} renderOrder={22} raycast={() => null}>
        <sphereGeometry args={[0.03, 16, 12]} />
        <meshBasicMaterial color={SELECT_COLOR} depthTest={false} />
      </mesh>
    </group>
  );
}

/** Up/down arrows beside the selected piece while the height tool or Space is active. */
function HeightGuide() {
  const id = useEditor((s) => s.selectedId);
  const plane = useEditor((s) => s.movePlane);
  const space = useEditor((s) => s.heightModifier);
  const mode = useEditor((s) => s.mode);
  const walk = useEditor((s) => s.walkMode);
  const obj = useEditor((s) => (id ? s.workingScene?.objects.find((o) => o.id === id) : undefined));
  const ref = useRef<Group>(null);
  const tmp = useMemo(() => ({ q: new Quaternion(), f: new Vector3() }), []);
  useFrame(() => {
    const g = ref.current;
    const live = id ? registry.get(id) : undefined;
    if (!g || !live) return;
    live.getWorldPosition(g.position);
    live.getWorldQuaternion(tmp.q);
    tmp.f.set(0, 0, 1).applyQuaternion(tmp.q);
    g.rotation.set(0, Math.atan2(tmp.f.x, tmp.f.z), 0);
  });
  if (!obj || obj.locked || walk || mode !== 'translate' || (plane !== 'height' && !space)) return null;
  const [w, h] = effectiveDimsOf(obj);
  const x = w / 2 + 0.12;
  return (
    <group ref={ref}>
      <mesh position={[x, h / 2, 0]} raycast={() => null} renderOrder={20}>
        <cylinderGeometry args={[0.008, 0.008, h + 0.5, 8]} />
        <meshBasicMaterial color={SELECT_COLOR} depthTest={false} />
      </mesh>
      {[1, -1].map((dir) => (
        <mesh key={dir} position={[x, h / 2 + dir * (h / 2 + 0.3), 0]} rotation={[dir < 0 ? Math.PI : 0, 0, 0]} raycast={() => null} renderOrder={20}>
          <coneGeometry args={[0.045, 0.12, 12]} />
          <meshBasicMaterial color={SELECT_COLOR} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Alignment guides, the vertical-move guide/readout, and the rotation readout. */
function Guides() {
  useSyncExternalStore(dragFeedback.subscribe.bind(dragFeedback), () => dragFeedback.signature);
  const { guides, height, note, objectId } = dragFeedback;
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const g of guides) pts.push(...g.from, ...g.to);
    if (height) pts.push(height.down[0], height.baseY, height.down[2], ...height.down);
    if (!pts.length) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    return geo;
  }, [guides, height]);
  const obj = objectId ? objectById(objectId) : undefined;
  const notePos: Vec3 | null = obj ? [obj.transform.position[0], obj.transform.position[1] + effectiveDimsOf(obj)[1] + 0.35, obj.transform.position[2]] : null;
  return (
    <>
      {lines && (
        <lineSegments geometry={lines} renderOrder={30}>
          <lineBasicMaterial color="#5ee0c8" transparent opacity={0.9} depthTest={false} />
        </lineSegments>
      )}
      {height && (
        <Html position={height.at} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
          <div className="readout">
            {Math.round((height.baseY - height.floorY) * 100)} cm above floor
            {height.surfaceLabel ? ` · ${Math.round((height.baseY - height.surfaceY) * 100)} cm above ${height.surfaceLabel}` : ''}
          </div>
        </Html>
      )}
      {note && notePos && !height && (
        <Html position={notePos} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
          <div className="readout">{note}</div>
        </Html>
      )}
    </>
  );
}

