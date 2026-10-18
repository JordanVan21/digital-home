import { useStore } from "zustand";
import { Box, Boxes, Scan, Sun, PanelsTopLeft } from "lucide-react";
import { editor } from "../state/editor";
import { nextPreset, useLighting } from "../theme";
import { Button } from "./Button";

/** Round view buttons on the right edge: lighting preset, plan view, fit view. */
export function ViewControls() {
  const light = useLighting();
  const wallMode = useStore(editor.interaction, (s) => s.wallMode);
  const boundingBoxes = useStore(editor.interaction, (s) => s.boundingBoxes);
  const planView = useStore(editor.interaction, (s) => s.planView);
  return (
    <div className="view-controls" aria-label="View">
      <Button
        label={`Lighting: ${light.label} (click to change)`}
        className="round glass glass-button"
        onClick={() => {
          const next = nextPreset(light.id);
          editor.interaction.setState({ lighting: next.id });
          editor.notify(`Lighting: ${next.label}`);
        }}
      >
        <Sun size={19} />
      </Button>
      <Button
        label={`Walls: ${wallMode === "cutaway" ? "Cut away" : wallMode === "fade" ? "Fade" : "Show"}`}
        className="round glass glass-button"
        onClick={() =>
          editor.interaction.setState({
            wallMode:
              wallMode === "cutaway"
                ? "fade"
                : wallMode === "fade"
                  ? "show"
                  : "cutaway",
          })
        }
      >
        <PanelsTopLeft size={19} />
      </Button>
      <Button
        label="Bounding boxes"
        className="round glass glass-button"
        active={boundingBoxes}
        aria-pressed={boundingBoxes}
        onClick={() =>
          editor.interaction.setState((s) => ({
            boundingBoxes: !s.boundingBoxes,
          }))
        }
      >
        <Boxes size={19} />
      </Button>
      {/* Visual only: plan view rendering is not built yet. */}
      <Button
        label="2D plan view"
        className="round glass glass-button text-icon"
        active={planView}
        aria-pressed={planView}
        onClick={() =>
          editor.interaction.setState((s) => ({ planView: !s.planView }))
        }
      >
        2D
      </Button>
      <Button
        label="Fit room in view"
        className="round glass glass-button"
        onClick={() =>
          editor.interaction.setState((s) => ({ resetView: s.resetView + 1 }))
        }
      >
        <Scan size={18} />
      </Button>
    </div>
  );
}

/** Visual-only measurements toggle; dimension overlays are not built yet. */
export function MeasurementsToggle() {
  const on = useStore(editor.interaction, (s) => s.measurements);
  return (
    <button
      className="measurements glass"
      role="switch"
      aria-checked={on}
      onClick={() =>
        editor.interaction.setState((s) => ({ measurements: !s.measurements }))
      }
    >
      <Box size={19} strokeWidth={1.6} />
      <span>Measurements</span>
      <span className="switch">
        <span />
      </span>
    </button>
  );
}
