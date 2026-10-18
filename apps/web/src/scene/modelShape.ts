import { Mesh, Object3D } from "three";
const picking = new WeakMap<Object3D, boolean>();
export function supportsMeshPicking(scene: Object3D): boolean {
  const cached = picking.get(scene);
  if (cached !== undefined) return cached;
  let masked = false;
  scene.traverse((node) => {
    if (node instanceof Mesh) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      masked ||= materials.some((m) => m.transparent || m.alphaTest > 0);
    }
  });
  picking.set(scene, !masked);
  return !masked;
}
