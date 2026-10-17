import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "@house/contracts";

interface SelectionOutlineProps {
  dimensionsM: Vec3;
  color?: string;
}

/** Glowing wireframe bounding box with corner markers, echoing assets/test2.png. */
export function SelectionOutline({ dimensionsM, color = "#5aa9ff" }: SelectionOutlineProps) {
  const [w, h, d] = dimensionsM;
  const pad = 0.04;
  const bw = w + pad * 2;
  const bh = h + pad * 2;
  const bd = d + pad * 2;

  const edges = useMemo(() => {
    const geometry = new THREE.BoxGeometry(bw, bh, bd);
    return new THREE.EdgesGeometry(geometry);
  }, [bw, bh, bd]);

  const corners = useMemo<[number, number, number][]>(() => {
    const xs = [-bw / 2, bw / 2];
    const ys = [-bh / 2, bh / 2];
    const zs = [-bd / 2, bd / 2];
    const pts: [number, number, number][] = [];
    for (const x of xs) for (const y of ys) for (const z of zs) pts.push([x, y, z]);
    return pts;
  }, [bw, bh, bd]);

  return (
    <group position={[0, bh / 2, 0]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={color} toneMapped={false} />
      </lineSegments>
      {corners.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.025, 10, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
