import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { useSceneStore } from "../state/sceneStore";
import { RoomShellMesh } from "./RoomShellMesh";
import { SceneObjectMesh } from "./SceneObjectMesh";
import { CameraController } from "./CameraController";

export function SceneCanvas() {
  const shell = useSceneStore((s) => s.shell);
  const objects = useSceneStore((s) => s.scene.objects);
  const select = useSceneStore((s) => s.select);

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
      camera={{ fov: 42, near: 0.1, far: 100 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#1b1d21"]} />
      <CameraController target={roomCenter} initialPosition={initialCameraPosition} />

      <ambientLight intensity={0.35} color="#fff3e2" />
      <hemisphereLight args={["#cfe3ff", "#2a2420", 0.3]} />
      <directionalLight
        position={[-6, 7, 3]}
        intensity={1.6}
        color="#ffe3b0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
      />

      <Suspense fallback={null}>
        <Environment preset="apartment" />
      </Suspense>

      <RoomShellMesh shell={shell} />
      {objects.map((object) => (
        <SceneObjectMesh key={object.id} object={object} />
      ))}

    </Canvas>
  );
}
