import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Mesh,
  Object3D,
  Vector3,
} from "three";
import { bakeGeometry, buildProfile } from "../geometry-lab/queries";
// Cache immutable renderer-only geometry per loaded asset. Never use this
// approximation for accepted-scene collision or support decisions.
const shapes = new WeakMap<Object3D, BufferGeometry | null>();
export function shapeEdges(scene: Object3D) {
  if (shapes.has(scene)) return shapes.get(scene)!;
  let masked = false;
  scene.traverse((node) => {
    if (node instanceof Mesh) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      masked ||= materials.some((m) => m.transparent || m.alphaTest > 0);
    }
  });
  if (masked) {
    shapes.set(scene, null);
    return null;
  }
  const baked = bakeGeometry(scene);
  const profile = buildProfile(baked);
  const positions: number[] = [];
  for (const box of profile.boxes) {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const cube = new BoxGeometry(size.x, size.y, size.z);
    cube.translate(center.x, center.y, center.z);
    const edges = new EdgesGeometry(cube);
    positions.push(...Array.from(edges.getAttribute("position").array));
    edges.dispose();
    cube.dispose();
  }
  baked.dispose();
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(positions, 3));
  shapes.set(scene, result);
  return result;
}
