import { useStore } from "zustand";
import { X } from "lucide-react";
import { editor } from "../state/editor";
import { Button } from "./Button";
const FINISHES = { oak: "Light oak", honey: "Honey oak", walnut: "Walnut" };
export function RoomInspector() {
  const room = useStore(editor.room, (s) => s.room),
    draft = useStore(editor.draft, (s) => s.scene),
    accepted = useStore(editor.scene, (s) => s.scene),
    dragging = useStore(editor.interaction, (s) => s.dragging);
  const scene = draft ?? accepted,
    appearance = scene.appearance ?? {};
  const xs = room.shell.floor.polygonXZ.map((p) => p[0]),
    zs = room.shell.floor.polygonXZ.map((p) => p[1]);
  const change = (next: typeof appearance) =>
    editor.suggest({
      type: "setAppearance",
      appearance: { ...appearance, ...next },
    });
  return (
    <aside className="inspector glass" aria-label="Room inspector">
      <div className="panel-heading">
        <span>Room</span>
        <Button
          label="Hide room details"
          className="tiny-button"
          onClick={() => editor.interaction.setState({ inspector: false })}
        >
          <X size={14} />
        </Button>
      </div>
      <h2>{room.name}</h2>
      <p className="subtle">
        {scene.objects.length} pieces ·{" "}
        {(Math.max(...xs) - Math.min(...xs)).toFixed(1)} ×{" "}
        {(Math.max(...zs) - Math.min(...zs)).toFixed(1)} m
      </p>
      <section className="inspector-section">
        <h3>Room finishes</h3>
        <div className="rotation-readout">
          <label htmlFor="wall-paint">Wall paint</label>
          <input
            id="wall-paint"
            type="color"
            key={appearance.wallColor ?? "default"}
            defaultValue={appearance.wallColor ?? "#ece6dc"}
            disabled={dragging}
            onBlur={(e) => {
              if (e.currentTarget.value !== appearance.wallColor)
                change({ wallColor: e.currentTarget.value });
            }}
          />
        </div>
        <div className="rotation-readout">
          <label htmlFor="floor-finish">Floor finish</label>
          <select
            id="floor-finish"
            aria-label="Floor finish"
            value={appearance.floorMaterial ?? "oak"}
            disabled={dragging}
            onChange={(e) => change({ floorMaterial: e.currentTarget.value })}
          >
            {Object.entries(FINISHES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="subtle">
          Preview your finishes, then Accept to keep them.
        </p>
      </section>
    </aside>
  );
}
