import { LibraryDrop } from "./LibraryDrop";
import { useMarquee, SelectionSummary } from "./Marquee";
import { assetById } from "@house/contracts";
import { lightBudget } from "./lightBudget";
import { IdleFrameloop, PerfProbe } from "./IdleFrameloop";
import { Camera } from "./Camera";
import { Lighting } from "./Lighting";
import { memo, useEffect, useMemo, useRef } from "react";
import { diffScenes } from "@house/scene-engine";
import { labelLayer } from "./labelLayer";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Stats } from "@react-three/drei";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { useStore } from "zustand";
import { editor } from "../state/editor";
import { Furniture } from "./Furniture";
import { Room } from "./Room";
import { useLighting } from "../theme";

function Objects() {
  const accepted = useStore(editor.scene, (s) => s.scene);
  const draft = useStore(editor.draft, (s) => s.scene);
  const working = draft ?? accepted;
  const lights = useMemo(() => lightBudget(working, assetById), [working]);
  const added = useMemo(
    () => new Set(draft ? diffScenes(accepted, draft).added : []),
    [accepted, draft],
  );
  return (
    <>
      {working.objects.map((o) => (
        <Furniture
          key={o.id}
          object={o}
          isNew={added.has(o.id)}
          lightEnabled={lights.active.has(o.id)}
          lightShadow={lights.shadows.has(o.id)}
        />
      ))}
    </>
  );
}
function Stage() {
  const light = useLighting();
  return (
    <>
      <LibraryDrop />
      <Lighting />
      <Room />
      <Objects />
      <ContactShadows
        position={[0, -0.17, 0]}
        opacity={0.3}
        scale={12}
        blur={2.8}
        far={4}
        resolution={512}
        color={light.shadow}
        frames={Infinity}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.19, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={light.backdrop} roughness={1} />
      </mesh>
      <Camera />
      <IdleFrameloop />
      {new URLSearchParams(window.location.search).has("perf") && <PerfProbe />}
      {new URLSearchParams(window.location.search).has("debug") && <Stats />}
    </>
  );
}
export const SceneCanvas = memo(function SceneCanvas() {
  const wrapper = useRef<HTMLDivElement>(null);
  const marquee = useMarquee();
  useEffect(() => {
    const update = () => {
      const { hoveredId, dragging, navigationMode } =
        editor.interaction.getState();
      const locked = editor
        .working()
        .objects.find((o) => o.id === hoveredId)?.locked;
      if (wrapper.current)
        wrapper.current.className = `canvas-wrap ${navigationMode !== "edit" ? `camera-${navigationMode}` : dragging ? "dragging" : locked ? "locked" : hoveredId ? "hovering" : ""}`;
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
      {...marquee.handlers}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/house-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const asset =
          assetById[e.dataTransfer.getData("application/house-asset")];
        const point = editor.motion.dropPoint?.(e.clientX, e.clientY);
        if (asset && point) {
          e.preventDefault();
          editor.dropAsset(asset, point);
        }
      }}
      className="canvas-wrap"
    >
      <Canvas
        frameloop="demand"
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
          if (
            editor.interaction.getState().navigationMode === "edit" &&
            e.button === 0 &&
            !e.shiftKey
          )
            editor.select(null);
        }}
      >
        <Stage />
      </Canvas>
      <div ref={marquee.box} className="selection-marquee" />
      <SelectionSummary />
    </div>
  );
});
