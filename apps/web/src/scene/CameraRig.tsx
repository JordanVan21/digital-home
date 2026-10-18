import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Box3, Euler, PerspectiveCamera, Vector3, type Camera } from 'three';
import type { RoomShell } from '@house/contracts';
import { effectiveDimsOf, obbAabbXZ, obbOf, polygonBounds, resolveTranslation, type Body } from '@house/scene-engine';
import { obstaclesFor } from '../state/physics';
import { opContext, toast, useEditor, type CameraPreset } from '../state/store';
import { photoCamera } from './photoCamera';

export { photoCamera } from './photoCamera';

export function roomFrame(shell: RoomShell) {
  const b = polygonBounds(shell.floor.polygonXZ);
  const center = new Vector3((b.min[0] + b.max[0]) / 2, 0, (b.min[1] + b.max[1]) / 2);
  const w = b.max[0] - b.min[0];
  const d = b.max[1] - b.min[1];
  const height = Math.max(...shell.walls.map((x) => x.heightM), 2.4);
  const radius = Math.hypot(w, d, height) / 2;
  return { center, w, d, height, radius, box: new Box3(new Vector3(b.min[0], 0, b.min[1]), new Vector3(b.max[0], height, b.max[1])) };
}

/** Camera pose for a preset, framed on the room's bounding box. */
export function presetPose(shell: RoomShell, preset: CameraPreset, aspect: number, fovDeg = 45): { position: Vector3; target: Vector3; fov: number } {
  const { center, w, d, radius } = roomFrame(shell);
  const fit = radius / Math.sin((fovDeg * Math.PI) / 360) / Math.min(1, aspect);
  switch (preset) {
    case 'match': {
      const p = photoCamera.current;
      if (p) return { position: new Vector3(...p.position), target: new Vector3(...p.target), fov: p.fov };
      return presetPose(shell, 'iso', aspect, fovDeg);
    }
    case 'top':
      return { position: center.clone().add(new Vector3(0, fit * 1.05, 0.001)), target: center.clone(), fov: 45 };
    case 'eye':
      return {
        position: center.clone().add(new Vector3(-w * 0.3, 1.6, d * 0.38)),
        target: center.clone().add(new Vector3(w * 0.15, 1.0, -d * 0.25)),
        fov: 45,
      };
    case 'iso':
    case 'reset':
    default: {
      const dir = new Vector3(0.62, 0.72, 0.9).normalize();
      return { position: center.clone().add(dir.multiplyScalar(fit * 0.95)), target: center.clone().add(new Vector3(0, 0.4, 0)), fov: 45 };
    }
  }
}

function setFov(camera: Camera, fov: number) {
  if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 1e-3) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/**
 * Drei CameraControls (camera-controls): damped orbit/pan/dolly with zoom-to-cursor, smooth
 * animated preset/focus/frame transitions, camera kept above the floor, distance scaled to the
 * room. Chosen over OrbitControls for its built-in transitions (setLookAt/fitToBox/moveTo) and
 * dolly-to-cursor.
 */
export function CameraRig({ shell }: { shell: RoomShell }) {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const request = useEditor((s) => s.cameraRequest);
  const walk = useEditor((s) => s.walkMode);
  const frame = useMemo(() => roomFrame(shell), [shell]);

  const goPreset = (preset: CameraPreset, animate: boolean) => {
    const c = ref.current;
    if (!c) return;
    const pose = presetPose(shell, preset, size.width / Math.max(1, size.height));
    setFov(camera, pose.fov);
    void c.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, animate);
  };

  useEffect(() => goPreset(photoCamera.current ? 'match' : 'reset', false), [shell]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = ref.current;
    if (!c || !request) return;
    if (request.type === 'preset') goPreset(request.preset, true);
    else if (request.type === 'focus') void c.moveTo(request.point[0], request.point[1], request.point[2], true);
    else if (request.target === 'room') goPreset('reset', true);
    else {
      const s = useEditor.getState();
      const sel = s.workingScene?.objects.filter((o) => s.selectedIds.includes(o.id)) ?? [];
      if (!sel.length) return goPreset('reset', true);
      const box = new Box3();
      for (const o of sel) {
        const a = obbAabbXZ(obbOf(o));
        box.expandByPoint(new Vector3(a.min[0], o.transform.position[1], a.min[1]));
        box.expandByPoint(new Vector3(a.max[0], o.transform.position[1] + effectiveDimsOf(o)[1], a.max[1]));
      }
      void c.fitToBox(box, true, { paddingTop: 0.4, paddingBottom: 0.4, paddingLeft: 0.4, paddingRight: 0.4 });
    }
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <CameraControls
        ref={ref}
        makeDefault
        enabled={!walk}
        minDistance={0.4}
        maxDistance={frame.radius * 6}
        maxPolarAngle={Math.PI / 2 - 0.05}
        dollyToCursor
        smoothTime={0.22}
        draggingSmoothTime={0.08}
      />
      {walk && <WalkControls controls={ref} />}
    </>
  );
}

const EYE = 1.6;
const SPEED = 1.6;

/**
 * Walk mode: eye-level first-person view. WASD/arrows move, drag to look, Esc exits. The camera
 * collides with furniture (not rugs) and walls via the same block-and-slide resolver as editing.
 */
function WalkControls({ controls }: { controls: React.RefObject<CameraControls> }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: 0, pitch: 0 });

  useEffect(() => {
    const keySet = keys.current;
    const ctrl = controls.current;
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    look.current = { yaw: Math.atan2(-dir.x, -dir.z), pitch: 0 };
    const target = new Vector3();
    ctrl?.getTarget(target);
    // Start at eye height, inside the room, at the orbit target pulled back toward the camera.
    const start = target.clone().lerp(camera.position, 0.35);
    camera.position.set(start.x, EYE, start.z);
    const shell = useEditor.getState().shell;
    if (shell) {
      const b = polygonBounds(shell.floor.polygonXZ);
      camera.position.x = Math.min(b.max[0] - 0.3, Math.max(b.min[0] + 0.3, camera.position.x));
      camera.position.z = Math.min(b.max[1] - 0.3, Math.max(b.min[1] + 0.3, camera.position.z));
    }
    setFov(camera, 60);
    toast('Walk mode — WASD to move, drag to look, Esc to exit.', 'info', 2500);

    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { useEditor.setState({ walkMode: false }); return; }
      keySet.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => keySet.delete(e.key.toLowerCase());
    let dragging = false;
    let last = [0, 0];
    const pd = (e: PointerEvent) => { dragging = true; last = [e.clientX, e.clientY]; };
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      look.current.yaw -= (e.clientX - last[0]!) * 0.004;
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - (e.clientY - last[1]!) * 0.004));
      last = [e.clientX, e.clientY];
    };
    const pu = () => { dragging = false; };
    const el = gl.domElement;
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      keySet.clear();
      setFov(camera, 45);
      const f = new Vector3();
      camera.getWorldDirection(f);
      const t = camera.position.clone().add(f.multiplyScalar(2));
      void ctrl?.setLookAt(camera.position.x, camera.position.y, camera.position.z, t.x, t.y, t.z, false);
    };
  }, [camera, gl, controls]);

  useFrame((_, dt) => {
    const k = keys.current;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const { yaw, pitch } = look.current;
    if (fwd || side) {
      const step = Math.min(dt, 0.05) * SPEED * (k.has('shift') ? 2 : 1);
      const dx = (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * step;
      const dz = (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * step;
      const ctx = opContext();
      const scene = useEditor.getState().workingScene;
      if (ctx && scene) {
        const p = camera.position;
        const r = 0.18;
        const body: Body = {
          id: '__camera__', label: 'you', kind: 'solid',
          boxes: [{ center: [p.x, p.z], u: [1, 0], v: [0, 1], halfW: r, halfD: r, yMin: 0.25, yMax: EYE + 0.1 }],
          min: [p.x - r, 0.25, p.z - r], max: [p.x + r, EYE + 0.1, p.z + r],
        };
        const obstacles = obstaclesFor(ctx, scene, [], { bounds: { min: [p.x - 1, 0, p.z - 1], max: [p.x + 1, 2, p.z + 1] } });
        const res = resolveTranslation([body], obstacles, [0, 0], [dx, dz]);
        p.x += res.offset[0];
        p.z += res.offset[1];
      }
    }
    camera.position.y = EYE;
    camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
  });
  return null;
}
