import { Suspense, memo, useEffect, useRef, type ComponentRef } from "react";
import { labelLayer } from "./labelLayer";
import { Canvas, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  Stats,
} from "@react-three/drei";
import { ACESFilmicToneMapping, SRGBColorSpace, MathUtils } from "three";
import { useStore } from "zustand";
import { editor } from "../state/editor";
import { Furniture } from "./Furniture";
import { Room } from "./Room";
function Camera() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  useEffect(() => {
    const reset = () => {
      camera.position.set(7.2, 6.5, 8.3);
      controls.current?.target.set(0, 0.65, 0);
      controls.current?.update();
    };
    reset();
    const unsub = editor.interaction.subscribe((s, prev) => {
      if (controls.current) controls.current.enabled = !s.dragging;
      if (s.resetView !== prev.resetView) reset();
    });
    return unsub;
  }, [camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0.65, 0]}
      minDistance={4.5}
      maxDistance={17}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2 - 0.08}
      enableDamping
      dampingFactor={0.09}
      onChange={() => {
        const orbit = controls.current;
        if (!orbit) return;
        const { x, y, z } = orbit.target;
        orbit.target.set(
          MathUtils.clamp(x, -1.8, 1.8),
          MathUtils.clamp(y, 0.25, 1.4),
          MathUtils.clamp(z, -1.5, 1.5),
        );
        camera.position.x += orbit.target.x - x;
        camera.position.y += orbit.target.y - y;
        camera.position.z += orbit.target.z - z;
      }}
    />
  );
}
function Objects() {
  const objects = useStore(editor.scene, (s) => s.scene.objects);
  return (
    <>
      {objects.map((o) => (
        <Furniture key={o.id} object={o} />
      ))}
    </>
  );
}
function Stage() {
  return (
    <>
      <color attach="background" args={["#e9e6df"]} />
      <fog attach="fog" args={["#e9e6df", 18, 45]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#fff1da", "#c3b7a0", 1.3]} />
      <directionalLight
        position={[-3.5, 7, 2]}
        intensity={3.5}
        color="#ffe3b5"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
        shadow-radius={3}
      />
      <Suspense fallback={null}>
        <Environment resolution={128} frames={1}>
          <Lightformer
            intensity={2.5}
            color="#fff2dc"
            position={[-5, 5, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[8, 5, 1]}
          />
          <Lightformer
            intensity={1.3}
            color="#eef0ff"
            position={[4, 6, 2]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[6, 6, 1]}
          />
        </Environment>
      </Suspense>
      <Room />
      <Objects />
      <ContactShadows
        position={[0, -0.17, 0]}
        opacity={0.3}
        scale={12}
        blur={2.8}
        far={4}
        resolution={512}
        color="#77634f"
        frames={Infinity}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.19, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#e9e6df" roughness={1} />
      </mesh>
      <Camera />
      {new URLSearchParams(window.location.search).has("debug") && <Stats />}
    </>
  );
}
export const SceneCanvas = memo(function SceneCanvas() {
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const { hoveredId, dragging } = editor.interaction.getState();
      const locked = editor.scene
        .getState()
        .scene.objects.find((o) => o.id === hoveredId)?.locked;
      if (wrapper.current)
        wrapper.current.className = `canvas-wrap ${dragging ? "dragging" : locked ? "locked" : hoveredId ? "hovering" : ""}`;
    };
    const interaction = editor.interaction.subscribe(update),
      scene = editor.scene.subscribe(update);
    update();
    return () => {
      interaction();
      scene();
    };
  }, []);
  return (
    <div
      ref={(el) => {
        wrapper.current = el;
        labelLayer.current = el!;
      }}
      className="canvas-wrap"
    >
      <Canvas
        shadows
        dpr={[1, 1.7]}
        camera={{ position: [7.2, 6.5, 8.3], fov: 39, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: ACESFilmicToneMapping,
          outputColorSpace: SRGBColorSpace,
        }}
        onPointerMissed={(e) => {
          if (e.button === 0) editor.select(null);
        }}
      >
        <Stage />
      </Canvas>
    </div>
  );
});
