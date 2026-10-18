import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import type { Vec2 } from '@house/contracts';
import { registry } from './registry';
import { useEditor } from '../state/store';

/**
 * Lets DOM UI (library drawer clicks / drag-and-drop) ask the 3D view for the floor point under
 * the cursor or the camera target, and which object (if any) is under the cursor.
 */
const bridge: { camera: Camera | null; dom: HTMLElement | null; root: Object3D | null; target: Vector3 | null; controls: { getTarget?: (v: Vector3) => Vector3; target?: Vector3 } | null } = {
  camera: null, dom: null, root: null, target: null, controls: null,
};

export function CanvasBridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as { target?: Vector3 } | null;
  useEffect(() => {
    bridge.camera = camera;
    bridge.dom = gl.domElement;
    bridge.root = scene;
    const c = controls as { getTarget?: (v: Vector3) => Vector3; target?: Vector3 } | null;
    bridge.target = c?.getTarget ? c.getTarget(new Vector3()) : c?.target ?? null;
    bridge.controls = c;
    if (import.meta.env.DEV) {
      // Dev/test hook for headless checks: project world points to client pixels, read the store.
      (window as unknown as { __houseDebug?: unknown }).__houseDebug = {
        project(x: number, y: number, z: number) {
          const v = new Vector3(x, y, z).project(camera);
          const r = gl.domElement.getBoundingClientRect();
          return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
        },
        store: useEditor,
        registry,
      };
    }
  }, [camera, gl, scene, controls]);
  return null;
}

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const ray = new Raycaster();

function rayAt(clientX: number, clientY: number): boolean {
  if (!bridge.camera || !bridge.dom) return false;
  const r = bridge.dom.getBoundingClientRect();
  ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), bridge.camera);
  return true;
}

/** Floor (y = 0) point under a screen position, or null when the ray misses the floor plane. */
export function floorPointAt(clientX: number, clientY: number): Vec2 | null {
  if (!rayAt(clientX, clientY)) return null;
  const hit = ray.ray.intersectPlane(floorPlane, new Vector3());
  return hit ? [hit.x, hit.z] : null;
}

/** Floor point at the orbit target (where the camera is looking). */
export function cameraTargetFloorPoint(): Vec2 | null {
  const c = bridge.controls;
  const t = c?.getTarget ? c.getTarget(new Vector3()) : c?.target ?? bridge.target;
  return t ? [t.x, t.z] : null;
}

/** objectId of the furniture instance under a screen position (innermost), if any. */
export function objectIdAt(clientX: number, clientY: number): string | null {
  if (!rayAt(clientX, clientY) || !bridge.root) return null;
  const objects = bridge.root.getObjectByName('scene-objects');
  if (!objects) return null;
  for (const hit of ray.intersectObject(objects, true)) {
    let o: Object3D | null = hit.object;
    while (o && !o.userData.objectId) o = o.parent;
    if (o) return o.userData.objectId as string;
  }
  return null;
}

/** Camera forward projected on the floor, snapped to the nearest world axis (for arrow-key nudges). */
export function cameraAxisXZ(): { forward: Vec2; right: Vec2 } {
  const cam = bridge.camera;
  const f = new Vector3(0, 0, -1);
  if (cam) cam.getWorldDirection(f);
  let fx = f.x;
  let fz = f.z;
  if (Math.abs(fx) > Math.abs(fz)) { fx = Math.sign(fx); fz = 0; } else { fz = Math.sign(fz) || -1; fx = 0; }
  return { forward: [fx, fz], right: [-fz, fx] };
}
