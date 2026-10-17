import { useState } from "react";
import { Html, Line } from "@react-three/drei";
import { Move, RotateCw, Lock, Unlock, Copy, Trash2, Crosshair } from "lucide-react";
import type { SceneObject } from "@house/contracts";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore } from "../state/interactionStore";
import { CoordinatesPopup } from "./CoordinatesPopup";

interface ObjectContextToolbarProps {
  object: SceneObject;
}

const CONNECTOR_LENGTH = 0.4;

/** Floats above the selected object, mirroring assets' HomeCanvas reference. */
export function ObjectContextToolbar({ object }: ObjectContextToolbarProps) {
  const tool = useInteractionStore((s) => s.tool);
  const setTool = useInteractionStore((s) => s.setTool);
  const setLock = useSceneStore((s) => s.setLock);
  const duplicateObject = useSceneStore((s) => s.duplicateObject);
  const deleteObject = useSceneStore((s) => s.deleteObject);
  const [showCoords, setShowCoords] = useState(false);

  const topY = object.dimensionsM[1];
  const anchorY = topY + CONNECTOR_LENGTH;

  return (
    <group>
      <Line
        points={[
          [0, topY + 0.02, 0],
          [0, anchorY, 0],
        ]}
        color="#5aa9ff"
        lineWidth={1.5}
        transparent
        opacity={0.8}
      />
      <mesh position={[0, topY + 0.02, 0]}>
        <sphereGeometry args={[0.02, 10, 10]} />
        <meshBasicMaterial color="#5aa9ff" toneMapped={false} />
      </mesh>

      <Html position={[0, anchorY, 0]} center style={{ pointerEvents: "none" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="context-toolbar">
            <button
              className={tool === "move" ? "active" : ""}
              title="Move (G)"
              onClick={() => setTool("move")}
            >
              <Move size={15} />
            </button>
            <button
              className={tool === "rotate" ? "active" : ""}
              title="Rotate (R)"
              onClick={() => setTool("rotate")}
            >
              <RotateCw size={15} />
            </button>
            <div className="divider" />
            <button
              className={showCoords ? "active" : ""}
              title="Edit coordinates"
              onClick={() => setShowCoords((v) => !v)}
            >
              <Crosshair size={15} />
            </button>
            <button
              title={object.locked ? "Unlock (L)" : "Lock (L)"}
              onClick={() => setLock(object.id, !object.locked)}
            >
              {object.locked ? <Lock size={15} /> : <Unlock size={15} />}
            </button>
            <button title="Duplicate (Cmd+D)" onClick={() => duplicateObject(object.id)}>
              <Copy size={15} />
            </button>
            <button
              className="danger"
              title="Delete (Del)"
              disabled={object.locked}
              onClick={() => deleteObject(object.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
          {showCoords && <CoordinatesPopup object={object} />}
        </div>
      </Html>
    </group>
  );
}
