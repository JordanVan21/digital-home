import { forwardRef, useEffect, useMemo } from "react";
import { BoxGeometry, EdgesGeometry, Group, type Vector3Tuple } from "three";
import type { Vec3 } from "@house/contracts";
export const Selection = forwardRef<
  Group,
  { dimensions: Vec3; selected: boolean; hovered: boolean }
>(function Selection({ dimensions: [w, h, d], selected, hovered }, ref) {
  const edges = useMemo(() => {
    const box = new BoxGeometry(w + 0.035, h + 0.035, d + 0.035);
    const result = new EdgesGeometry(box);
    box.dispose();
    return result;
  }, [w, h, d]);
  useEffect(() => () => edges.dispose(), [edges]);
  const corners = useMemo(
    () =>
      [-1, 1].flatMap((x) =>
        [-1, 1].flatMap((y) =>
          [-1, 1].map(
            (z) =>
              [
                (x * (w + 0.035)) / 2,
                (y * (h + 0.035)) / 2,
                (z * (d + 0.035)) / 2,
              ] as Vector3Tuple,
          ),
        ),
      ),
    [w, h, d],
  );
  return (
    <group ref={ref} position={[0, h / 2, 0]} visible={selected || hovered}>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial
          color={selected ? "#8b84ff" : "#ffffff"}
          transparent
          opacity={selected ? 1 : 0.6}
          depthTest={false}
        />
      </lineSegments>
      {selected &&
        corners.map((p, i) => (
          <mesh key={i} position={p} renderOrder={10} raycast={() => null}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshBasicMaterial color="#bcb8ff" depthTest={false} />
          </mesh>
        ))}
    </group>
  );
});
