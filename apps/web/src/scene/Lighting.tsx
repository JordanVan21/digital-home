import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Environment } from "@react-three/drei";
import type { DirectionalLight } from "three";
import { useStore } from "zustand";
import { editor } from "../state/editor";
import { useLighting } from "../theme";
import { lightingFrame } from "./lightingFrame";
/** One shadow-casting sun, a local CC0 HDR, and room-relative shadow bounds. */
export function Lighting() {
  const shell = useStore(editor.room, (s) => s.room.shell),
    light = useLighting();
  const frame = useMemo(
    () => lightingFrame(shell, light.sunElevationDeg),
    [shell, light.sunElevationDeg],
  );
  const sun = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cam = l.shadow.camera,
      r = frame.radius * (light.id === "golden-hour" ? 1.6 : 1);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = 40;
    cam.updateProjectionMatrix();
    l.target.position.fromArray(frame.target);
    l.target.updateMatrixWorld();
    l.shadow.needsUpdate = true;
  }, [frame, light.id]);
  return (
    <>
      <color attach="background" args={[light.backdrop]} />
      <fog
        attach="fog"
        args={[light.backdrop, 14, light.id === "golden-hour" ? 32 : 45]}
      />
      <ambientLight intensity={light.ambient} />
      <hemisphereLight
        args={[
          light.hemisphere.sky,
          light.hemisphere.ground,
          light.hemisphere.intensity,
        ]}
      />
      <directionalLight
        ref={sun}
        position={frame.position}
        intensity={light.sun.intensity}
        color={light.sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={3}
      />
      <Suspense fallback={null}>
        <Environment
          files={light.environment.file}
          environmentIntensity={light.environment.intensity}
        />
      </Suspense>
    </>
  );
}
