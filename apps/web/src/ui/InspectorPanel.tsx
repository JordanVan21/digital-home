import { Trash2 } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";
import { yawDegreesFromQuaternion } from "../lib/rotation";

function formatCategory(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function InspectorPanel() {
  const shell = useSceneStore((s) => s.shell);
  const scene = useSceneStore((s) => s.scene);
  const selected = useSceneStore((s) => s.getSelectedObject());
  const deleteObject = useSceneStore((s) => s.deleteObject);

  if (!selected) {
    const [w, , d] = shell.floor.polygonXZ.reduce(
      (acc, [x, z]) => [Math.max(acc[0], x), 0, Math.max(acc[1], z)] as [number, number, number],
      [0, 0, 0] as [number, number, number]
    );
    return (
      <div className="inspector-panel glass">
        <h3>Room</h3>
        <div className="inspector-row">
          <span>Footprint</span>
          <span className="value">
            {w.toFixed(1)} × {d.toFixed(1)} m
          </span>
        </div>
        <div className="inspector-row">
          <span>Objects</span>
          <span className="value">{scene.objects.length}</span>
        </div>
        <div className="inspector-row">
          <span>Lighting</span>
          <span className="value">{scene.lightingPreset.replace(/_/g, " ")}</span>
        </div>
        <div className="inspector-row">
          <span>Revision</span>
          <span className="value">{scene.revision}</span>
        </div>
        <div className="inspector-row">
          <span>Proposal</span>
          <span className="value">None</span>
        </div>
        <p className="empty-hint" style={{ marginTop: 12 }}>
          Select an object to inspect or edit it. Nothing here is sent anywhere yet — autosave is local-only until the API exists.
        </p>
      </div>
    );
  }

  return (
    <div className="inspector-panel glass">
      <h3>{selected.displayName}</h3>
      <div className="inspector-row">
        <span>Category</span>
        <span className="value">{formatCategory(selected.category)}</span>
      </div>
      <div className="inspector-row">
        <span>Locked</span>
        <span className="value">{selected.locked ? "Yes" : "No"}</span>
      </div>
      <div className="inspector-row">
        <span>Source</span>
        <span className="value">{selected.source.replace(/_/g, " ")}</span>
      </div>
      <div className="inspector-row">
        <span>Position</span>
        <span className="value">
          {selected.transform.position.map((n) => n.toFixed(2)).join(", ")} m
        </span>
      </div>
      <div className="inspector-row">
        <span>Yaw</span>
        <span className="value">{Math.round(yawDegreesFromQuaternion(selected.transform.rotation))}°</span>
      </div>
      <div className="inspector-row">
        <span>Dimensions</span>
        <span className="value">
          {selected.dimensionsM.map((n) => n.toFixed(2)).join(" × ")} m
        </span>
      </div>

      <div className="inspector-actions">
        <button className="btn" disabled title="Asset browser not built yet">
          Replace
        </button>
        <button
          className="btn"
          disabled={selected.locked}
          onClick={() => deleteObject(selected.id)}
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}
