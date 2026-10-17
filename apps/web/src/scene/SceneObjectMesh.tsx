import { useRef } from "react";
import { Html, TransformControls } from "@react-three/drei";
import type { Group } from "three";
import type { SceneObject } from "@house/contracts";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore } from "../state/interactionStore";
import { ObjectVisual } from "./objectVisuals";
import { SelectionOutline } from "./SelectionOutline";
import { ObjectContextToolbar } from "./ObjectContextToolbar";

interface SceneObjectMeshProps {
  object: SceneObject;
}

export function SceneObjectMesh({ object }: SceneObjectMeshProps) {
  const groupRef = useRef<Group>(null);
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const moveObject = useSceneStore((s) => s.moveObject);
  const tool = useInteractionStore((s) => s.tool);
  const setDragging = useInteractionStore((s) => s.setDragging);
  const hoveredId = useInteractionStore((s) => s.hoveredId);
  const setHovered = useInteractionStore((s) => s.setHovered);

  const selected = selectedId === object.id;
  const hovered = hoveredId === object.id;
  const showGizmo = selected && !object.locked && (tool === "move" || tool === "rotate");

  const commitTransform = () => {
    const g = groupRef.current;
    if (!g) return;
    const accepted = moveObject(object.id, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
      scale: [1, 1, 1],
    });
    if (!accepted) {
      // TransformControls already mutated the Three object imperatively
      // during the drag; since the store didn't change, the `position`/
      // `quaternion` props below won't re-apply on their own. Snap back
      // explicitly so a rejected drop doesn't leave the mesh floating in
      // an invalid spot (FEATURE_DESIGN.md: "invalid drop should snap back").
      g.position.set(...object.transform.position);
      g.quaternion.set(...object.transform.rotation);
    }
    setDragging(false);
  };

  return (
    <>
      {showGizmo && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode={tool === "move" ? "translate" : "rotate"}
          showY={tool === "move" ? false : true}
          showX={tool === "rotate" ? false : true}
          showZ={tool === "rotate" ? false : true}
          onMouseDown={() => setDragging(true)}
          onMouseUp={commitTransform}
        />
      )}
      <group
        ref={groupRef}
        position={object.transform.position}
        quaternion={object.transform.rotation}
        onClick={(e) => {
          e.stopPropagation();
          select(object.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(object.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = "auto";
        }}
      >
        <ObjectVisual category={object.category} dimensionsM={object.dimensionsM} />
        {(selected || hovered) && (
          <SelectionOutline
            dimensionsM={object.dimensionsM}
            color={selected ? "#5aa9ff" : "#9aa0a8"}
          />
        )}
        {object.locked && !selected && (
          <Html position={[0, object.dimensionsM[1] + 0.12, 0]} center distanceFactor={8}>
            <div className="lock-badge" title="Locked">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="10" rx="2" fill="#15171a" stroke="#e9eaec" strokeWidth="1.5" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#e9eaec" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
          </Html>
        )}
        {selected && <ObjectContextToolbar object={object} />}
      </group>
    </>
  );
}
