import { labelLayer } from '../scene/labelLayer';
import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Html, OrbitControls } from '@react-three/drei';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import type { AssetSpec, SceneObject } from '@house/contracts';
import { makeTransform } from '@house/scene-engine';
import { LocalAssetCatalog } from '../catalog/AssetCatalog';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { AssetModel } from '../scene/SceneObjectMesh';

/**
 * Dev-only catalog review (?gallery): every asset in the editor's lighting, at native size, with
 * an arrow showing +Z (the front every catalog model must face) and its catalog box.
 */
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const vec = (k: string, d: [number, number, number]) => (q.get(k)?.split(',').map(Number) as [number, number, number] | undefined) ?? d;

export function AssetGallery() {
  const [catalog, setCatalog] = useState<LocalAssetCatalog | null>(null);
  useEffect(() => void LocalAssetCatalog.load().then(setCatalog), []);
  if (!catalog) return null;
  const assets = catalog.list();
  const cols = 6;
  const gap = 3;
  return (
    <div style={{ position: 'fixed', inset: 0 }} ref={(el) => { labelLayer.current = el!; }}>
    <Canvas shadows camera={{ position: vec('cam', [7.5, 9, 16]), fov: 40 }} gl={{ toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}>
      <color attach="background" args={['#2a2b30']} />
      <Environment files={EDITOR_POLICY.hdrFile} environmentIntensity={0.8} />
      <directionalLight position={[4, 8, 6]} intensity={2} castShadow />
      <OrbitControls target={vec('target', [7.5, 0, 3])} makeDefault />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[7.5, -0.001, 4]}>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#6d6a66" />
      </mesh>
      {assets.map((a, i) => (
        <GalleryItem key={a.id} asset={a} url={catalog.resolveUrl(a.id)!} x={(i % cols) * gap} z={Math.floor(i / cols) * gap} />
      ))}
    </Canvas>
    </div>
  );
}

function GalleryItem({ asset, url, x, z }: { asset: AssetSpec; url: string; x: number; z: number }) {
  const obj: SceneObject = {
    id: asset.id, assetId: asset.id, category: asset.category, transform: makeTransform([x, 0, z], 0),
    dimensionsM: asset.dimensionsM, locked: false, source: 'catalog', displayName: asset.title,
  };
  const [w, h, d] = asset.dimensionsM;
  return (
    <group position={[x, 0, z]}>
      <Suspense fallback={null}>
        <AssetModel asset={asset} url={url} obj={obj} />
      </Suspense>
      <mesh position={[0, 0.01, d / 2 + 0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.3, 16]} />
        <meshBasicMaterial color="#8a8dff" />
      </mesh>
      <Html portal={labelLayer} position={[0, -0.05, d / 2 + 0.75]} center style={{ pointerEvents: 'none' }}>
        <div className="proxy-label">{asset.title} · {asset.category}</div>
      </Html>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial wireframe color="#ffffff" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}
