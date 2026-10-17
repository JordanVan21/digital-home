import { useEffect, useRef, useState } from "react";
import type { SceneObject } from "@house/contracts";
import { useSceneStore } from "../state/sceneStore";
import { quaternionFromYawDegrees, yawDegreesFromQuaternion } from "../lib/rotation";

interface CoordinatesPopupProps {
  object: SceneObject;
}

/**
 * A single numeric field buffered in local text state, so intermediate
 * keystrokes ("-", "1.") aren't clobbered by the re-render a committed
 * value triggers. Commits on blur/Enter; re-syncs from the external value
 * whenever it changes elsewhere (gizmo drag, undo) while this field isn't
 * focused.
 */
function NumberField({
  value,
  step,
  disabled,
  onCommit,
}: {
  value: number;
  step: number;
  disabled?: boolean;
  /** Returns whether the underlying op was accepted by the validator. */
  onCommit: (value: number) => boolean;
}) {
  const [text, setText] = useState(() => value.toFixed(2));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value.toFixed(2));
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    // Revert on a bad parse *or* a validator rejection (e.g. outside the
    // room floor) — either way the store's value didn't change, so the
    // field shouldn't keep showing the rejected input.
    const accepted = Number.isFinite(parsed) && onCommit(parsed);
    if (!accepted) setText(value.toFixed(2));
  };

  return (
    <input
      type="number"
      step={step}
      value={text}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(value.toFixed(2));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const AXES: { key: 0 | 1 | 2; label: string }[] = [
  { key: 0, label: "X" },
  { key: 1, label: "Y" },
  { key: 2, label: "Z" },
];

/**
 * Directly edits SceneObject.transform through the same moveObject ->
 * commitOp -> validateOp/applyOp path the gizmo uses. This is the manual
 * stand-in for what an agent planner will eventually do: load the scene
 * row and write a new transform for one object.
 */
export function CoordinatesPopup({ object }: CoordinatesPopupProps) {
  const moveObject = useSceneStore((s) => s.moveObject);

  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    const position = [...object.transform.position] as [number, number, number];
    position[axis] = value;
    return moveObject(object.id, { ...object.transform, position });
  };

  const setYaw = (degrees: number) => {
    return moveObject(object.id, { ...object.transform, rotation: quaternionFromYawDegrees(degrees) });
  };

  return (
    <div className="coords-popup" onPointerDown={(e) => e.stopPropagation()}>
      {AXES.map(({ key, label }) => (
        <label key={label} className="coords-row">
          <span>{label}</span>
          <NumberField
            value={object.transform.position[key]}
            step={0.05}
            disabled={object.locked}
            onCommit={(v) => setAxis(key, v)}
          />
        </label>
      ))}
      <label className="coords-row">
        <span>Yaw°</span>
        <NumberField
          value={yawDegreesFromQuaternion(object.transform.rotation)}
          step={5}
          disabled={object.locked}
          onCommit={setYaw}
        />
      </label>
    </div>
  );
}
