import { forwardRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Vec3 } from "@house/contracts";
import { labelLayer } from "./labelLayer";

type Handler = (e: ThreeEvent<PointerEvent>) => void;

/**
 * Flat ring around a selected piece; dragging it swivels the piece freely.
 * Lives inside the piece's group, so the handle stays at the piece's front (+Z).
 * Rotation itself is applied imperatively by the owner (Furniture).
 */
export const SwivelRing = forwardRef<
  HTMLSpanElement,
  {
    dimensions: Vec3;
    active: boolean;
    onDown: Handler;
    onMove: Handler;
    onUp: Handler;
  }
>(function SwivelRing(
  { dimensions: [w, , d], active, onDown, onMove, onUp },
  label,
) {
  const radius = Math.hypot(w, d) / 2 + 0.15;
  const handlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  };
  return (
    <group position={[0, 0.02, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
        renderOrder={9}
      >
        <torusGeometry args={[radius, 0.008, 6, 128]} />
        <meshBasicMaterial
          color="#8b84ff"
          transparent
          opacity={active ? 0.95 : 0.7}
          depthTest={false}
        />
      </mesh>
      {/* Wider invisible band so the thin ring is easy to grab. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} {...handlers}>
        <torusGeometry args={[radius, 0.07, 6, 64]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh position={[0, 0, radius]} renderOrder={10} {...handlers}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, radius]} renderOrder={10} raycast={() => null}>
        <sphereGeometry args={[0.03, 16, 12]} />
        <meshBasicMaterial color="#8b84ff" depthTest={false} />
      </mesh>
      {active && (
        <Html
          portal={labelLayer}
          zIndexRange={[5, 0]}
          position={[0, 0.08, radius + 0.18]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="angle-label" ref={label} />
        </Html>
      )}
    </group>
  );
});
