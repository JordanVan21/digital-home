import { useStore } from "zustand";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  X,
  LockKeyhole,
  UnlockKeyhole,
  Trash2,
  Box,
} from "lucide-react";
import { assetById } from "@house/contracts";
import { yawOf } from "@house/scene-engine";
import { editor } from "../state/editor";
import { Button } from "./Button";
export function InspectorPanel() {
  const id = useStore(editor.interaction, (s) => s.selectedId),
    open = useStore(editor.interaction, (s) => s.inspector);
  const object = useStore(editor.scene, (s) =>
    s.scene.objects.find((o) => o.id === id),
  );
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const asset = object?.assetId ? assetById[object.assetId] : undefined;
  if (!open || !object) return null;
  const yaw =
    ((((yawOf(object.transform.rotation) * 180) / Math.PI) % 360) + 360) % 360;
  return (
    <aside className="inspector glass" aria-label="Inspector">
      <div className="panel-heading">
        <span>Details</span>
        <Button
          label="Hide details"
          className="tiny-button"
          onClick={() => editor.interaction.setState({ inspector: false })}
        >
          <X size={14} />
        </Button>
      </div>
      <>
        <div className="object-preview">
          {asset?.thumbnailStorageKey ? (
            <img src={asset.thumbnailStorageKey} alt={asset.title} />
          ) : (
            <Box size={50} strokeWidth={1} />
          )}
          <span className="category-chip">
            {object.category.replaceAll("-", " ")}
          </span>
        </div>
        <h2>{object.displayName}</h2>
        <p className="subtle">
          {object.source === "roomplan_approximation"
            ? "A close approximation of your piece"
            : "A piece in your room"}
        </p>
        <button
          className={`lock-control ${object.locked ? "is-locked" : ""}`}
          aria-label={
            object.locked ? "Unlock selected object" : "Lock selected object"
          }
          aria-pressed={object.locked}
          disabled={dragging}
          onClick={() => editor.toggleLock()}
        >
          {object.locked ? (
            <LockKeyhole size={15} />
          ) : (
            <UnlockKeyhole size={15} />
          )}
          <span>{object.locked ? "Locked in place" : "Free to move"}</span>
          <span className="toggle-track">
            <span />
          </span>
        </button>
        <section className="inspector-section">
          <h3>
            Position <small>meters</small>
          </h3>
          <div className="readout-grid">
            {["X", "Y", "Z"].map((label, i) => (
              <div key={label}>
                <span>{label}</span>
                <output>{object.transform.position[i].toFixed(2)}</output>
              </div>
            ))}
          </div>
          <div className="rotation-readout">
            <span>Rotation</span>
            <output>{yaw.toFixed(0)}°</output>
            <Button
              label="Rotate counterclockwise 15°"
              disabled={object.locked || dragging}
              className="step-button"
              onClick={() => editor.rotate(-1)}
            >
              −
            </Button>
            <Button
              label="Rotate clockwise 15°"
              disabled={object.locked || dragging}
              className="step-button"
              onClick={() => editor.rotate()}
            >
              +
            </Button>
          </div>
        </section>
        <section className="inspector-section">
          <h3>
            Dimensions <small>W × H × D</small>
          </h3>
          <p className="dimensions">
            {object.dimensionsM.map((n) => n.toFixed(2)).join(" × ")}{" "}
            <span>m</span>
          </p>
          <div className="asset-source">
            <ArrowDownToLine size={13} />
            {asset ? (
              <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                FurniMesh · Licensed model ↗
              </a>
            ) : (
              <span>Scanned object · Approximate</span>
            )}
          </div>
        </section>
        <div className="inspector-actions">
          <Button
            label="Replace model"
            className="secondary-button"
            disabled={object.locked || dragging}
            onClick={() =>
              editor.interaction.setState({ browser: true, replacing: true })
            }
          >
            <ArrowLeftRight size={14} />
            Replace model
          </Button>
          <Button
            label="Delete selected object"
            className="danger-button"
            disabled={object.locked || dragging}
            onClick={() => editor.remove()}
          >
            <Trash2 size={15} />
          </Button>
        </div>
        <p className="panel-footnote">
          {object.locked
            ? "Unlock this piece to make changes."
            : "Drag to move. Hold Shift to snap to 10 cm."}
        </p>
      </>
    </aside>
  );
}
