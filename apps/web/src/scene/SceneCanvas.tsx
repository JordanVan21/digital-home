import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore } from "../state/interactionStore";
import { RoomShellMesh } from "./RoomShellMesh";
import { SceneObjectMesh } from "./SceneObjectMesh";
import { CameraController } from "./CameraController";

const LIGHTING_PRESETS: Record<string, { sun: string; intensity: number; ambient: string; env: "apartment" | "city" }> = {
  golden_hour: { sun: "#ffe3b0", intensity: 1.6, ambient: "#fff3e2", env: "apartment" },
  daylight: { sun: "#eaf2ff", intensity: 1.9, ambient: "#eef4ff", env: "city" },
};

export function SceneCanvas() {
  const shell = useSceneStore((s) => s.shell);
  const objects = useSceneStore((s) => s.scene.objects);
  const lightingPreset = useSceneStore((s) => s.scene.lightingPreset);
  const select = useSceneStore((s) => s.select);
  const showMeasurements = useInteractionStore((s) => s.showMeasurements);

  const lighting = LIGHTING_PRESETS[lightingPreset] ?? LIGHTING_PRESETS.golden_hour;

  const roomCenter = useMemo<[number, number, number]>(() => {
    const pts = shell.floor.polygonXZ;
    const cx = pts.reduce((sum, [x]) => sum + x, 0) / pts.length;
    const cz = pts.reduce((sum, [, z]) => sum + z, 0) / pts.length;
    return [cx, 0.9, cz];
  }, [shell.floor.polygonXZ]);

  // Positioned so the sightline to roomCenter clears the open-top walls
  // (no ceiling) rather than grazing/clipping through the far wall.
  const initialCameraPosition = useMemo<[number, number, number]>(
    () => [roomCenter[0] - 1.2, 8.5, roomCenter[2] + 7.5],
    [roomCenter]
  );

  return (
    <Canvas
      shadows
      gl={{ alpha: true }}
      camera={{ fov: 42, near: 0.1, far: 100 }}
      onPointerMissed={() => select(null)}
    >
      <CameraController target={roomCenter} initialPosition={initialCameraPosition} />

      <ambientLight intensity={0.35} color={lighting.ambient} />
      <hemisphereLight args={["#cfe3ff", "#2a2420", 0.3]} />
      <directionalLight
        position={[-6, 7, 3]}
        intensity={lighting.intensity}
        color={lighting.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
      />

      {/* Lighting/reflections only — the out-of-focus surroundings are a CSS
          backdrop behind the (transparent) canvas, see .backdrop in ui.css. */}
      <Suspense fallback={null}>
        <Environment preset={lighting.env} />
      </Suspense>

      <RoomShellMesh shell={shell} showMeasurements={showMeasurements} />
      {objects.map((object) => (
        <SceneObjectMesh key={object.id} object={object} />
      ))}
    </Canvas>
  );
}
