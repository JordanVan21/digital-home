import { RefreshCw, Sparkles, Eye, Clock } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore } from "../state/interactionStore";

const MODE_LABEL: Record<string, string> = {
  select: "Edit",
  move: "Edit · Move",
  rotate: "Edit · Rotate",
};

export function TopBar() {
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const tool = useInteractionStore((s) => s.tool);
  const requestResetView = useInteractionStore((s) => s.requestResetView);

  return (
    <div className="top-bar">
      <span className="room-name">Living Room</span>
      <span className="mode-label">{MODE_LABEL[tool] ?? "Edit"}</span>

      <div className="spacer" />

      <div className={`save-status ${saveStatus}`}>
        <span className="dot" />
        {saveStatus === "saving" ? "Saving…" : saveStatus === "offline" ? "Offline changes" : "Saved"}
      </div>

      <div className="top-bar-actions">
        <button className="btn" disabled title="Coming in a later phase">
          <Sparkles size={14} /> Design
        </button>
        <button className="btn" disabled title="Available once a proposal exists">
          <Eye size={14} /> Preview
        </button>
        <button className="btn" disabled title="Coming in a later phase">
          <Clock size={14} /> Timeline
        </button>
        <button className="btn" onClick={requestResetView}>
          <RefreshCw size={14} /> Reset View
        </button>
      </div>
    </div>
  );
}
