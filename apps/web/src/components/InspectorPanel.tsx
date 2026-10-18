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
import { useWorkingObject } from "../state/useWorking";
import { Button } from "./Button";
import { providerLabel } from "./provider";
export function InspectorPanel() {
  const id = useStore(editor.interaction, (s) => s.selectedId),
    open = useStore(editor.interaction, (s) => s.inspector);
  const object = useWorkingObject(id);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const movePlane = useStore(editor.interaction, (s) => s.movePlane);
  const draftScene = useStore(editor.draft, (s) => s.scene);
  const acceptedScene = useStore(editor.scene, (s) => s.scene);
  const tool = useStore(editor.interaction, (s) => s.tool);
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
            <label htmlFor="height-input">Height</label>
            <input
              id="height-input"
              key={`${object.id}-height-${object.transform.position[1]}`}
              className="rotation-input"
              type="number"
              step={0.1}
              defaultValue={Number(object.transform.position[1].toFixed(3))}
              disabled={object.locked || dragging}
              aria-label="Height in meters"
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const value = e.currentTarget.valueAsNumber;
                if (
                  Number.isFinite(value) &&
                  value !== object.transform.position[1]
                )
                  editor.suggest({
                    type: "move",
                    objectId: object.id,
                    transform: {
                      ...object.transform,
                      position: [
                        object.transform.position[0],
                        value,
                        object.transform.position[2],
                      ],
                    },
                  });
              }}
            />
            <span className="unit">m</span>
          </div>
          <p className="subtle">
            {object.placement?.support === "object"
              ? `Resting on ${(draftScene ?? acceptedScene).objects.find((o) => o.id === object.placement?.parentId)?.displayName ?? "furniture"}.`
              : "Nearby floor and object faces snap into place. Hold Alt to move freely."}
          </p>
          <Button
            label="Place on floor"
            className="secondary-button"
            disabled={object.locked || dragging}
            onClick={() =>
              editor.suggest({
                type: "move",
                objectId: object.id,
                transform: {
                  ...object.transform,
                  position: [
                    object.transform.position[0],
                    editor.context().room.floor.elevationY,
                    object.transform.position[2],
                  ],
                },
              })
            }
          >
            Place on floor
          </Button>
          <div className="rotation-readout">
            <label htmlFor="rotation-input">Rotation</label>
            {/* Keyed on the angle so it resyncs after swivels, undo and steps. */}
            <input
              id="rotation-input"
              key={`${object.id}-${Math.round(yaw)}`}
              className="rotation-input"
              type="number"
              step={1}
              defaultValue={Math.round(yaw)}
              disabled={object.locked || dragging}
              aria-label="Rotation in degrees"
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const value = Number(e.currentTarget.value);
                if (
                  Number.isFinite(value) &&
                  Math.round(value) !== Math.round(yaw)
                )
                  editor.setYaw((value * Math.PI) / 180);
              }}
            />
            <span className="unit">°</span>
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
              asset.sourceUrl ? (
                <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                  {providerLabel(asset)}
                  {asset.source === "furnimesh" ? " · Licensed model" : ""} ↗
                </a>
              ) : (
                <span>{providerLabel(asset)}</span>
              )
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
            : tool === "rotate"
              ? "Drag inside the circle to rotate. Shift snaps to 15°."
              : movePlane === "height"
                ? "Drag up or down to change height. Shift snaps to 10 cm."
                : "Drag to move. Hold Space for height, Shift for grid snapping."}
        </p>
      </>
    </aside>
  );
}
