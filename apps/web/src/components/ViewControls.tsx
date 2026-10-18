import { CameraViewMenu } from "./CameraViewMenu";
import { useStore } from "zustand";
import {
  Boxes,
  Scan,
  Sun,
  Moon,
  PanelsTopLeft,
  Hand,
  Orbit,
  MousePointer2,
} from "lucide-react";
import { editor } from "../state/editor";
import { nextPreset, useLighting } from "../theme";
import { Button } from "./Button";
import { usePanelTheme } from "../uiTheme";

/** Round view buttons on the right edge: lighting preset, plan view, fit view. */
export function ViewControls() {
  const light = useLighting();
  const { theme, toggle } = usePanelTheme();
  const wallMode = useStore(editor.interaction, (s) => s.wallMode);
  const boundingBoxes = useStore(editor.interaction, (s) => s.boundingBoxes);
  const planView = useStore(editor.interaction, (s) => s.planView);
  return (
    <div className="view-controls" aria-label="View">
      <Button
        label={`Switch to ${theme === "light" ? "dark" : "light"} panels`}
        className="round glass glass-button"
        onClick={toggle}
        aria-pressed={theme === "dark"}
      >
        {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
      </Button>
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
      <CameraViewMenu />
      <Button
        label="2D plan view"
        className="round glass glass-button text-icon"
        active={planView}
        aria-pressed={planView}
        onClick={() => editor.requestView(planView ? "iso" : "top")}
      >
        2D
      </Button>
      <Button
        label="Fit room in view"
        className="round glass glass-button"
        onClick={() => editor.requestView("room")}
      >
        <Scan size={18} />
      </Button>
    </div>
  );
}

/** Explicit camera modes leave the selected furniture and its draft untouched. */
export function NavigationControls() {
  const mode = useStore(editor.interaction, (s) => s.navigationMode);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  return (
    <div
      className="navigation-controls glass"
      role="radiogroup"
      aria-label="Mouse controls"
    >
      {(
        [
          ["edit", "Edit objects", "Edit", MousePointer2],
          ["orbit", "Orbit camera", "Orbit", Orbit],
          ["pan", "Pan camera", "Pan", Hand],
        ] as const
      ).map(([id, label, text, Icon]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-label={label}
          aria-checked={mode === id}
          disabled={dragging}
          title={
            id === "edit"
              ? "Select and edit furniture"
              : `Left-drag to ${text.toLowerCase()} without selecting furniture`
          }
          onClick={() =>
            editor.interaction.setState({
              navigationMode: id,
              walk: false,
              hoveredId: null,
            })
          }
        >
          <Icon size={16} />
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}
