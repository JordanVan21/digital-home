import { RoomInspector } from "./RoomInspector";
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
import {
  rotationDegrees,
  rotationFromDegrees,
  onNearestSurface,
} from "@house/scene-engine";
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
  if (!open) return null;
  if (!object) return <RoomInspector />;
  const angles = rotationDegrees(object.transform.rotation);
  const setAngles = (next: typeof angles) =>
    editor.suggest({
      type: "move",
      objectId: object.id,
      transform: { ...object.transform, rotation: rotationFromDegrees(next) },
    });
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
                  position: onNearestSurface(
                    { ...editor.working(), objects: [] },
                    object,
                    editor.context().room,
                    editor.context().assets,
                  ).transform.position,
                },
              })
            }
          >
            Place on floor
          </Button>
          <h3>
            Rotation <small>degrees</small>
          </h3>
          {(["X (pitch)", "Y (turn)", "Z (roll)"] as const).map((label, i) => (
            <div className="rotation-readout" key={label}>
              <label htmlFor={`rotation-${i}`}>{label}</label>
              <input
                id={`rotation-${i}`}
                className="rotation-input"
                type="number"
                step={1}
                key={`${object.id}-${i}-${angles[i].toFixed(3)}`}
                defaultValue={Number(angles[i].toFixed(1))}
                aria-label={
                  i === 1 ? "Rotation in degrees" : `${label} in degrees`
                }
                disabled={object.locked || dragging}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (
                    Number.isFinite(value) &&
                    Math.abs(value - angles[i]) > 0.01
                  ) {
                    const next = [...angles] as typeof angles;
                    next[i] = value;
                    setAngles(next);
                  }
                }}
              />
              <Button
                label={
                  i === 1
                    ? "Rotate counterclockwise 15°"
                    : `Rotate ${label} minus 15°`
                }
                className="step-button"
                disabled={object.locked || dragging}
                onClick={() => {
                  const next = [...angles] as typeof angles;
                  next[i] -= 15;
                  setAngles(next);
                }}
              >
                −
              </Button>
              <Button
                label={
                  i === 1 ? "Rotate clockwise 15°" : `Rotate ${label} plus 15°`
                }
                className="step-button"
                disabled={object.locked || dragging}
                onClick={() => {
                  const next = [...angles] as typeof angles;
                  next[i] += 15;
                  setAngles(next);
                }}
              >
                +
              </Button>
            </div>
          ))}
          <div className="inspector-actions">
            <Button
              label="Lay flat"
              className="secondary-button"
              disabled={object.locked || dragging}
              onClick={() => setAngles([90, angles[1], 0])}
            >
              Lay flat
            </Button>
            <Button
              label="Lean back 15°"
              className="secondary-button"
              disabled={object.locked || dragging}
              onClick={() => setAngles([-15, angles[1], 0])}
            >
              Lean back 15°
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
