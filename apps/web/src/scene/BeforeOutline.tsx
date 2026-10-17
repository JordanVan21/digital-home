import { useEffect, useMemo } from "react";
import { BoxGeometry, EdgesGeometry, LineSegments } from "three";
import type { SceneObject } from "@house/contracts";

/** Faint dashed box at a piece's accepted transform: the "before" side of a suggestion. */
export function BeforeOutline({ object }: { object: SceneObject }) {
  const [w, h, d] = object.dimensionsM;
  const lines = useMemo(() => {
    const box = new BoxGeometry(w, h, d);
    const segments = new LineSegments(new EdgesGeometry(box));
    box.dispose();
    segments.computeLineDistances();
    return segments;
  }, [w, h, d]);
  useEffect(() => () => lines.geometry.dispose(), [lines]);
  return (
    <group
      position={object.transform.position}
      quaternion={object.transform.rotation}
      scale={object.transform.scale}
    >
      <primitive object={lines} position={[0, h / 2, 0]} raycast={() => null}>
        <lineDashedMaterial
          color="#6b6f78"
          dashSize={0.06}
          gapSize={0.05}
          transparent
          opacity={0.55}
          depthTest={false}
        />
      </primitive>
    </group>
  );
}
