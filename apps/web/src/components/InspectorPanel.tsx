import { useState } from "react";
import { lightSpecFor } from "../scene/lightBudget";
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
  const [keepProportions, setKeepProportions] = useState(true);
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
        {lightSpecFor(object, assetById) && (
          {asset?.variants && <section className="inspector-section"><h3>Finish</h3><div className="finish-swatches">{asset.variants.map(v=><button key={v.id} title={v.name} aria-label={`Finish: ${v.name}`} aria-pressed={JSON.stringify(object.materialOverrides)===JSON.stringify(v.overrides)} disabled={object.locked || dragging} style={{background:v.swatch}} onClick={()=>editor.suggest({type:"changeMaterial",objectId:object.id,overrides:v.overrides})}/>)}<button className="secondary-button" disabled={object.locked || dragging} onClick={()=>editor.suggest({type:"changeMaterial",objectId:object.id})}>Original finish</button></div></section>}
        <section className="inspector-section"><h3>Plan</h3><select aria-label="Plan for this piece" value={object.renovationDecision ?? ""} disabled={dragging} onChange={e=>editor.suggest({type:"setPlan",objectId:object.id,decision:(e.target.value || undefined) as "keep"|"replace"|"remove"|undefined})}><option value="">Not decided</option><option value="keep">Keep</option><option value="replace">Replace</option><option value="remove">Remove</option></select></section>
        <section className="inspector-section"><label><input type="checkbox" aria-label="Allow floating after Accept" checked={object.placement?.float ?? false} disabled={object.locked || dragging} onChange={e=>editor.suggest({type:"setFloat",objectId:object.id,float:e.target.checked})}/> Allow floating after Accept</label></section>
        <section className="inspector-section">
            <h3>Lighting</h3>
            <Button
              label={
                object.lightOn === false
                  ? "Switch light on"
                  : "Switch light off"
              }
              className="secondary-button"
              disabled={object.locked || dragging}
              aria-pressed={object.lightOn !== false}
              onClick={() =>
                editor.suggest({
                  type: "setLight",
                  objectId: object.id,
                  lightOn: object.lightOn === false,
                })
              }
            >
              Light {object.lightOn === false ? "off" : "on"}
            </Button>
          </section>
        )}
        <section className="inspector-section">
          <h3>
            Position <small>meters</small>
          </h3>
          {(["X", "Y / Height", "Z"] as const).map((label, i) => (
            <div className="rotation-readout" key={label}>
              <label htmlFor={`position-${i}`}>{label}</label>
              <input
                id={`position-${i}`}
                key={`${object.id}-${i}-${object.transform.position[i]}`}
                className="rotation-input"
                type="number"
                step={0.01}
                defaultValue={Number(object.transform.position[i].toFixed(3))}
                disabled={object.locked || dragging}
                aria-label={
                  i === 1 ? "Height in meters" : `${label} position in meters`
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (
                    Number.isFinite(value) &&
                    value !== object.transform.position[i]
                  ) {
                    const position = [
                      ...object.transform.position,
                    ] as typeof object.transform.position;
                    position[i] = value;
                    editor.suggest(
                      {
                        type: "move",
                        objectId: object.id,
                        transform: { ...object.transform, position },
                      },
                      { snap: false },
                    );
                  }
                }}
              />
              <span className="unit">m</span>
            </div>
          ))}
          <p className="subtle">
            {object.placement?.support === "object"
              ? `Resting on ${(draftScene ?? acceptedScene).objects.find((o) => o.id === object.placement?.parentId)?.displayName ?? "furniture"}.`
              : object.placement?.support === "wall"
                ? "Drag along walls and around corners. Accept reattaches free edits."
                : object.placement?.support === "ceiling"
                  ? "Attached to the ceiling. Accept reattaches free height edits."
                  : "Nearby floor and object faces snap into place. Hold Alt to move freely."}
          </p>
          <Button
            label={
              object.placement?.support === "wall"
                ? "Remount on wall"
                : object.placement?.support === "ceiling"
                  ? "Attach to ceiling"
                  : "Place on floor"
            }
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
            {object.placement?.support === "wall"
              ? "Remount on wall"
              : object.placement?.support === "ceiling"
                ? "Attach to ceiling"
                : "Place on floor"}
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
          <label className="subtle">
            <input
              type="checkbox"
              checked={keepProportions}
              disabled={object.locked || dragging}
              onChange={(e) => setKeepProportions(e.target.checked)}
            />{" "}
            Keep proportions
          </label>
          {(["Width", "Height", "Depth"] as const).map((label, i) => (
            <div className="rotation-readout" key={label}>
              <label htmlFor={`dimension-${i}`}>{label}</label>
              <input
                id={`dimension-${i}`}
                className="rotation-input"
                type="number"
                min={0.001}
                step={0.01}
                key={`${object.id}-dimension-${i}-${object.dimensionsM[i]}-${object.transform.scale[i]}`}
                defaultValue={Number(
                  (object.dimensionsM[i] * object.transform.scale[i]).toFixed(
                    3,
                  ),
                )}
                aria-label={`${label} dimension in meters`}
                disabled={object.locked || dragging}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const value =
                    e.currentTarget.valueAsNumber / object.transform.scale[i];
                  if (
                    !Number.isFinite(value) ||
                    value <= 0 ||
                    value === object.dimensionsM[i]
                  )
                    return;
                  const dimensionsM = object.dimensionsM.map((n, axis) =>
                    keepProportions
                      ? (n * value) / object.dimensionsM[i]
                      : axis === i
                        ? value
                        : n,
                  ) as typeof object.dimensionsM;
                  editor.suggest({
                    type: "resize",
                    objectId: object.id,
                    dimensionsM,
                  });
                }}
              />
              <span className="unit">m</span>
            </div>
          ))}

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
