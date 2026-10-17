import { useEffect, useState } from "react";
import { Sparkles, ChevronRight, Sun, Grid2x2, Maximize, Minimize, Ruler, RefreshCw } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore } from "../state/interactionStore";

export function RightRail() {
  const lightingPreset = useSceneStore((s) => s.scene.lightingPreset);
  const setLightingPreset = useSceneStore((s) => s.setLightingPreset);
  const requestTopDownView = useInteractionStore((s) => s.requestTopDownView);
  const requestResetView = useInteractionStore((s) => s.requestResetView);
  const showMeasurements = useInteractionStore((s) => s.showMeasurements);
  const toggleMeasurements = useInteractionStore((s) => s.toggleMeasurements);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  const isDaylight = lightingPreset === "daylight";

  return (
    <div className="right-rail">
      <button className="ai-pill glass" disabled title="Coming in a later phase">
        <Sparkles size={14} /> AI Design Assistant <ChevronRight size={13} />
      </button>

      <div className="icon-rail glass">
        <button
          className={`icon-btn-sm ${isDaylight ? "active" : ""}`}
          title={isDaylight ? "Switch to golden hour lighting" : "Switch to daylight lighting"}
          onClick={() => setLightingPreset(isDaylight ? "golden_hour" : "daylight")}
        >
          <Sun size={16} />
        </button>
        <button className="icon-btn-sm" title="Snap to top view" onClick={requestTopDownView}>
          <Grid2x2 size={16} />
        </button>
        <button className="icon-btn-sm" title="Reset view" onClick={requestResetView}>
          <RefreshCw size={16} />
        </button>
        <button
          className="icon-btn-sm"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>

      <button className="toggle-pill glass" onClick={toggleMeasurements}>
        <Ruler size={14} /> Measurements
        <span className={`toggle-switch ${showMeasurements ? "on" : ""}`}>
          <span className="knob" />
        </span>
      </button>
    </div>
  );
}
