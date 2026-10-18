import { labelLayer } from '../labelLayer';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, Float32BufferAttribute, Vector3, type Mesh, type Object3D, type Raycaster } from 'three';
import type { Vec3 } from '@house/contracts';
import { classOf, effectiveDimsOf, obbOf, rootsOf, selectionPivot } from '@house/scene-engine';
import { EDITOR_POLICY } from '../../config/editorPolicy';
import { focusCamera, objectById, opContext, select, selectMany, useEditor } from '../../state/store';
import { dragFeedback } from '../dragFeedback';
import { interaction, registry } from '../registry';
import { boxSelect } from './boxSelect';
import { hitPlaneY, modsOf, MoveSession, RotateSession, setRay, type DragSession, type Host } from './sessions';

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
 * event, so a press on furniture or the rotation ring turns orbiting off for that drag:
 * - press + drag on an unlocked object → move it (Alt = lift; Ctrl/Cmd = ignore collisions);
 * - press + drag on the ring → turn it; Shift+drag on empty space → box select;
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
      id: string | null; x: number; y: number; down: PointerEvent; box: boolean; draggable: boolean; session: DragSession | null;
    } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!press) return;
      if (!press.session && !(press.box && boxSelect.get())) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < EDITOR_POLICY.clickMaxDeltaPx) return;
        if (press.id && press.draggable) {
          const st = useEditor.getState();
          const inSel = st.selectedIds.includes(press.id);
          if (!inSel) select(press.id);
          const ids = useEditor.getState().selectedIds;
          // Rotate tool: dragging the piece itself turns it (codex's swivel), with jordan's collisions.
          const turn = useEditor.getState().mode === 'rotate' ? new RotateSession(host, press.down, modsOf(press.down)) : null;
          const s = turn?.ok ? turn : new MoveSession(host, press.down, ids, press.id, modsOf(press.down));
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
      if (ring.current?.visible && r.intersectObject(ring.current, false).length) {
        const s = new RotateSession(host, e, modsOf(e));
        if (!s.ok) return;
        setControls(false);
        setHover(false);
        press = { id: null, x: e.clientX, y: e.clientY, down: e, box: false, draggable: false, session: s };
      } else {
        const id = objectAt(r, scene.getObjectByName('scene-objects'));
        const obj = id ? objectById(id) : undefined;
        const draggable = !!obj && !obj.locked;
        const box = !id && e.shiftKey;
        if (draggable || box) setControls(false);
        press = { id, x: e.clientX, y: e.clientY, down: e, box, draggable, session: null };
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
    };

    // Scroll wheel while dragging raises / lowers the piece (the camera doesn't zoom mid-drag).
    const onWheel = (e: WheelEvent) => {
      const s = press?.session as (DragSession & { wheel?: (dy: number) => void }) | null | undefined;
      if (!s?.wheel) return;
      e.preventDefault();
      e.stopPropagation();
      s.wheel(e.deltaY);
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
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, scene, controls, setEvents]);

  return (
    <>
      <RotationRing meshRef={ring} />
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
 * Rotate tool only (codex's swivel): a ring around the selection whose whole disk is grabbable —
 * drag anywhere inside the circle (or on the piece itself) to turn it. Works from any camera angle;
 * jordan's collisions still block or push it clear.
 */
function RotationRing({ meshRef }: { meshRef: React.RefObject<Mesh | null> }) {
  const sel = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.workingScene?.objects);
  const mode = useEditor((s) => s.mode);
  const walk = useEditor((s) => s.walkMode);
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
    const inner = radius + 0.12;
    const outer = inner + 0.08;
    const band = (r0: number, r1: number) => {
      const g = new BufferGeometry();
      const pos: number[] = [];
      const N = 96;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        const p = (r: number, a: number) => [Math.sin(a) * r, 0, Math.cos(a) * r];
        pos.push(...p(r0, a0), ...p(r1, a0), ...p(r1, a1), ...p(r0, a0), ...p(r1, a1), ...p(r0, a1));
      }
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      return g;
    };
    // `g` (the grab area) is the full disk; `ring` is the visible band at its edge.
    return { g: band(0, outer), ring: band(inner, outer), pivot: pivot as [number, number], y: Math.min(...roots.map((r) => r.transform.position[1])) + 0.008, outer };
  }, [roots, objects]);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const m = meshRef.current;
    if (!m || !geom) return;
    // A single object's ring follows it live (during moves and lifts).
    const g = roots.length === 1 ? registry.get(roots[0]!.id) : undefined;
    if (g) {
      g.getWorldPosition(tmp);
      m.position.set(tmp.x, tmp.y + 0.008, tmp.z);
    }
  });

  if (!geom || walk || mode !== 'rotate') return null;
  return (
    <mesh ref={meshRef} geometry={geom.g} position={[geom.pivot[0], geom.y, geom.pivot[1]]} renderOrder={20}>
      <meshBasicMaterial color="#8a8dff" transparent opacity={0.08} depthTest={false} depthWrite={false} side={2} />
      <mesh geometry={geom.ring} renderOrder={21} raycast={() => null}>
        <meshBasicMaterial color="#8a8dff" transparent opacity={0.75} depthTest={false} depthWrite={false} side={2} />
      </mesh>
    </mesh>
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
        <Html portal={labelLayer} position={height.at} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
          <div className="readout">
            {Math.round((height.baseY - height.floorY) * 100)} cm above floor
            {height.surfaceLabel ? ` · ${Math.round((height.baseY - height.surfaceY) * 100)} cm above ${height.surfaceLabel}` : ''}
          </div>
        </Html>
      )}
      {note && notePos && !height && (
        <Html portal={labelLayer} position={notePos} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
          <div className="readout">{note}</div>
        </Html>
      )}
    </>
  );
}

