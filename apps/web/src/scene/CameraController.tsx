import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useInteractionStore } from "../state/interactionStore";

interface CameraControllerProps {
  target: [number, number, number];
  initialPosition: [number, number, number];
}

export function CameraController({ target, initialPosition }: CameraControllerProps) {
  // `any`: OrbitControls' imperative handle type lives in three-stdlib, a
  // transitive dep of drei we don't want to depend on directly for one ref.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const resetViewToken = useInteractionStore((s) => s.resetViewToken);
  const isDragging = useInteractionStore((s) => s.isDragging);
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(...initialPosition);
    controlsRef.current?.target.set(...target);
    controlsRef.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetViewToken]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!isDragging}
      target={target}
      minDistance={1.5}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2 - 0.02}
      enableDamping
      dampingFactor={0.08}
    />
  );
}
