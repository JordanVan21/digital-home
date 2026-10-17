import { Component, Suspense, useMemo, type ReactNode } from "react";
import { Html, useGLTF } from "@react-three/drei";
import { Box3, Mesh, Vector3 } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AssetSpec, SceneObject } from "@house/contracts";
import { resolveAsset } from "../fixtures/assetCatalog";
import { ObjectVisual } from "./objectVisuals";

class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.warn("[asset-load] Using approximate proxy", error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Model({ asset, dimensionsM }: { asset: AssetSpec; dimensionsM: SceneObject["dimensionsM"] }) {
  const { scene } = useGLTF(`/${asset.glbStorageKey}`);
  const model = useMemo(() => {
    // Object3Ds cannot have multiple parents. Clone the hierarchy per instance,
    // including skeletons, while retaining the URL cache's geometry/textures.
    const instance = clone(scene);
    instance.updateMatrixWorld(true);
    const box = new Box3().setFromObject(instance);
    const size = box.getSize(new Vector3());
    if (![size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error(`Empty or invalid model bounds: ${asset.id}`);
    }
    const center = box.getCenter(new Vector3());
    instance.position.sub(new Vector3(center.x, box.min.y, center.z));
    instance.traverse((child) => {
      if (child instanceof Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return { instance, size };
  }, [scene, asset.id]);
  // Preserve the artist's proportions and fit the scanned object's conservative
  // footprint. Never stretch upholstery or let visuals escape collision bounds.
  const scale = Math.min(...dimensionsM.map((n, i) => n / model.size.getComponent(i)));
  return <group scale={scale} dispose={null}><primitive object={model.instance} /></group>;
}

function Proxy({ object, message }: { object: SceneObject; message: string }) {
  return <>
    <ObjectVisual category={object.category} dimensionsM={object.dimensionsM} />
    <Html position={[0, object.dimensionsM[1] + 0.08, 0]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
      <span style={{ whiteSpace: "nowrap", fontSize: 10, color: "#555", background: "#ffffffcc", borderRadius: 6, padding: "2px 5px" }}>
        {message}
      </span>
    </Html>
  </>;
}

export function AssetVisual({ object }: { object: SceneObject }) {
  const asset = resolveAsset(object.assetId);
  if (!asset) return <Proxy object={object} message="Approximate · no approved model" />;
  return <AssetBoundary key={asset.id} fallback={<Proxy object={object} message="Model unavailable · approximate" />}>
    <Suspense fallback={<Proxy object={object} message="Loading model…" />}>
      <Model asset={asset} dimensionsM={object.dimensionsM} />
    </Suspense>
  </AssetBoundary>;
}
