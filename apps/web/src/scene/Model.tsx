import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { Html, useGLTF } from "@react-three/drei";
import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  BufferGeometry,
} from "three";
import { assetById, type SceneObject } from "@house/contracts";
import { supportsMeshPicking } from "./modelShape";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { labelLayer } from "./labelLayer";
export function Proxy({
  object,
  loading = false,
}: {
  object: SceneObject;
  loading?: boolean;
}) {
  const [w, h, d] = object.dimensionsM;
  return (
    <group>
      <mesh
        position={[0, h / 2, 0]}
        castShadow
        receiveShadow
        raycast={() => null}
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#c5bfb3" roughness={0.9} />
      </mesh>
      {/* Loading proxies are Suspense fallbacks: an <Html> portal there gets its
          React root unmounted mid-render when the model resolves. */}
      {!loading && (
        <Html
          portal={labelLayer}
          zIndexRange={[2, 0]}
          position={[0, h + 0.09, 0]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="proxy-label">
            {object.displayName} <small>approx.</small>
          </span>
        </Html>
      )}
    </group>
  );
}
class ModelBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
const pickingGeometry = new WeakMap<BufferGeometry, BufferGeometry>();
function GLB({
  object,
  onShape,
}: {
  object: SceneObject;
  onShape?: (ready: boolean) => void;
}) {
  const asset = assetById[object.assetId!];
  const { scene } = useGLTF(asset.glbStorageKey, false, true);
  const meshPicking = useMemo(() => supportsMeshPicking(scene), [scene]);
  useEffect(() => {
    onShape?.(meshPicking);
    return () => onShape?.(false);
  }, [meshPicking, onShape]);
  const { clone, scale, offset, materials } = useMemo(() => {
    const clone = scene.clone(true);
    const materials: MeshStandardMaterial[] = [];
    clone.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = object.category !== "rug";
        child.receiveShadow = true;
        if (!meshPicking) child.raycast = () => null;
        else {
          let geometry = pickingGeometry.get(child.geometry);
          if (!geometry) {
            const owned: BufferGeometry = child.geometry.clone();
            owned.boundsTree = new MeshBVH(owned, { maxLeafTris: 10 });
            pickingGeometry.set(child.geometry, owned);
            geometry = owned;
          }
          child.geometry = geometry;
          child.raycast = acceleratedRaycast;
        }
        const source = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const owned = source.map((m) => {
          const mat = m.clone() as MeshStandardMaterial;
          materials.push(mat);
          const override =
            object.materialOverrides?.[m.name] ??
            object.materialOverrides?.["*"];
          if (override?.colorHex) mat.color.set(override.colorHex);
          if (override?.roughness !== undefined)
            mat.roughness = override.roughness;
          return mat;
        });
        child.material = Array.isArray(child.material) ? owned : owned[0];
      }
    });
    clone.updateMatrixWorld(true);
    const box = new Box3().setFromObject(clone),
      size = box.getSize(new Vector3()),
      center = box.getCenter(new Vector3());
    return {
      clone,
      scale: object.dimensionsM.map(
        (v, i) => v / [size.x, size.y, size.z][i],
      ) as [number, number, number],
      offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
      materials,
    };
  }, [
    scene,
    meshPicking,
    object.dimensionsM,
    object.materialOverrides,
    object.category,
  ]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group scale={scale}>
      <primitive object={clone} position={offset} />
    </group>
  );
}
export function Model({
  object,
  onShape,
}: {
  object: SceneObject;
  onShape?: (ready: boolean) => void;
}) {
  if (!object.assetId || !assetById[object.assetId])
    return <Proxy object={object} />;
  return (
    <ModelBoundary key={object.assetId} fallback={<Proxy object={object} />}>
      <Suspense fallback={<Proxy object={object} loading />}>
        <GLB object={object} onShape={onShape} />
      </Suspense>
    </ModelBoundary>
  );
}
