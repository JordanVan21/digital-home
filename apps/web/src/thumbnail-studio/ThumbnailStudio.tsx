import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  useGLTF,
} from "@react-three/drei";
import { ACESFilmicToneMapping, Box3, Sphere, Vector3 } from "three";
import { assetById } from "@house/contracts";

/**
 * Dev-only studio that renders one catalog model as a library thumbnail,
 * matching the existing cards: a three-quarter view on the cream card colour.
 * `scripts/render-thumbnails.mjs` drives it in GPU Chrome via
 * `?thumbnail-studio=<assetId>` and waits for `window.__thumbnailReady`.
 */
const BACKGROUND = "#f5f2ea";

function Subject({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const sphere = useMemo(
    () => new Box3().setFromObject(scene).getBoundingSphere(new Sphere()),
    [scene],
  );
  useLayoutEffect(() => {
    scene.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const azimuth = (35 * Math.PI) / 180,
      elevation = (22 * Math.PI) / 180;
    const fov = ((camera as { fov?: number }).fov ?? 30) * (Math.PI / 180);
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.08;
    const dir = new Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    );
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    invalidate();
  }, [scene, sphere, camera, invalidate]);
  useEffect(() => {
    // Two frames after mount: shadows and the environment have rendered.
    let frames = 0;
    const tick = () => {
      if (++frames < 3) requestAnimationFrame(tick);
      else (window as { __thumbnailReady?: boolean }).__thumbnailReady = true;
    };
    requestAnimationFrame(tick);
  }, []);
  return (
    <>
      <primitive object={scene} />
      <ContactShadows
        position={[0, 0.001, 0]}
        scale={sphere.radius * 4}
        blur={2.4}
        opacity={0.35}
        far={sphere.radius * 2}
      />
    </>
  );
}

export default function ThumbnailStudio({ assetId }: { assetId: string }) {
  const asset = assetById[assetId];
  if (!asset) return <p>Unknown asset {assetId}</p>;
  return (
    <div style={{ width: 320, height: 320 }}>
      <Canvas
        shadows
        dpr={1}
        camera={{ fov: 30, near: 0.01, far: 100 }}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
          toneMapping: ACESFilmicToneMapping,
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <hemisphereLight args={["#fff8ee", "#d9d2c4", 1.1]} />
        <directionalLight
          position={[2.5, 5, 3.5]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <Environment resolution={128} frames={1}>
          <Lightformer
            intensity={2.2}
            position={[-4, 4, 2]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[6, 4, 1]}
          />
          <Lightformer
            intensity={1.2}
            position={[4, 5, 3]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[6, 6, 1]}
          />
        </Environment>
        <Suspense fallback={null}>
          <Subject url={asset.glbStorageKey} />
        </Suspense>
      </Canvas>
    </div>
  );
}
