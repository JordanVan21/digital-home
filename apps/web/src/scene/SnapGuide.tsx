import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { Html } from "@react-three/drei";
import { BufferGeometry, Group, Vector3 } from "three";
import type { Transform } from "@house/contracts";
import type { SurfaceFace } from "@house/scene-engine";
import { labelLayer } from "./labelLayer";
export type SnapGuideHandle = {
  update(face?: SurfaceFace, position?: Transform["position"]): void;
};
/** World-space contact outline and label; all pointer updates stay imperative. */
export const SnapGuide = forwardRef<SnapGuideHandle>(
  function SnapGuide(_, ref) {
    const root = useRef<Group>(null),
      labelGroup = useRef<Group>(null),
      text = useRef<HTMLSpanElement>(null);
    const geometry = useMemo(() => new BufferGeometry(), []);
    const previous = useRef("");
    useEffect(() => () => geometry.dispose(), [geometry]);
    useImperativeHandle(
      ref,
      () => ({
        update(face, position) {
          if (root.current) root.current.visible = !!face;
          if (text.current) {
            text.current.style.display = face ? "inline-block" : "none";
            text.current.textContent = face ? `Snapped to ${face.label}` : "";
          }
          if (!face) return;
          const key = `${face.key}-${face.heightY}-${face.polygonXZ.flat().join(",")}`;
          if (previous.current !== key) {
            geometry.setFromPoints(
              face.polygonXZ.map(
                ([x, z]) => new Vector3(x, face.heightY + 0.008, z),
              ),
            );
            previous.current = key;
          }
          if (labelGroup.current && position)
            labelGroup.current.position.set(
              position[0],
              face.heightY + 0.08,
              position[2],
            );
        },
      }),
      [geometry],
    );
    return (
      <group ref={root} visible={false} name="face-snap-guide">
        <lineLoop geometry={geometry} raycast={() => null} renderOrder={11}>
          <lineBasicMaterial
            color="#54bca2"
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </lineLoop>
        <group ref={labelGroup}>
          <Html
            portal={labelLayer}
            zIndexRange={[5, 0]}
            center
            style={{ pointerEvents: "none" }}
          >
            <span
              ref={text}
              className="angle-label"
              style={{ display: "none" }}
            />
          </Html>
        </group>
      </group>
    );
  },
);
