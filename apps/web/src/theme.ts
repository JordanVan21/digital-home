import { useStore } from "zustand";
import { editor } from "./state/editor";

/**
 * Lighting presets drive both the 3D lighting and the UI accent colour. The
 * glass chrome itself stays neutral; warmth belongs to the room's design, so a
 * minimal room gets cool daylight and a monochrome accent instead.
 */
export type LightingPreset = {
  id: string;
  label: string;
  /** Primary-action and active-state colour, plus the text drawn on it. */
  accent: string;
  accentInk: string;
  /** Page, fog and ground colour around the room. */
  backdrop: string;
  ambient: number;
  environment: { file: string; intensity: number };
  sunElevationDeg: number;
  hemisphere: { sky: string; ground: string; intensity: number };
  sun: {
    color: string;
    intensity: number;
    position: [number, number, number];
  };
  fill: {
    key: string;
    keyIntensity: number;
    rim: string;
    rimIntensity: number;
  };
  shadow: string;
  /** Multiplier for practical lights such as floor lamps. */
  lamps: number;
};

export const lightingPresets: LightingPreset[] = [
  {
    id: "daylight",
    label: "Daylight",
    accent: "#9e624b",
    accentInk: "#ffffff",
    backdrop: "#e9e5de",
    ambient: 0.08,
    environment: { file: "/hdr/warm-interior.hdr", intensity: 0.6 },
    sunElevationDeg: 48,
    hemisphere: { sky: "#fff1dd", ground: "#4a3626", intensity: 0.35 },
    sun: { color: "#ffe8cc", intensity: 2.4, position: [-2.5, 8, 3.5] },
    fill: { key: "#fff1dd", keyIntensity: 0, rim: "#ffffff", rimIntensity: 0 },
    shadow: "#77634f",
    lamps: 0,
  },
  {
    id: "golden-hour",
    label: "Golden hour",
    accent: "#bc6848",
    accentInk: "#ffffff",
    backdrop: "#d4c4ad",
    ambient: 0.06,
    environment: { file: "/hdr/golden-garden.hdr", intensity: 0.5 },
    sunElevationDeg: 20,
    hemisphere: { sky: "#ffd2a0", ground: "#4a3626", intensity: 0.32 },
    sun: { color: "#ffa95c", intensity: 4.6, position: [-3.5, 7, 2] },
    fill: { key: "#ffd2a0", keyIntensity: 0, rim: "#ffffff", rimIntensity: 0 },
    shadow: "#77634f",
    lamps: 1,
  },
  {
    id: "evening",
    label: "Evening",
    accent: "#c88165",
    accentInk: "#ffffff",
    backdrop: "#22232a",
    ambient: 0.025,
    environment: { file: "/hdr/warm-interior.hdr", intensity: 0.12 },
    sunElevationDeg: 30,
    hemisphere: { sky: "#b9c5df", ground: "#4a3626", intensity: 0.06 },
    sun: { color: "#8fa4c8", intensity: 0.25, position: [-2, 9, 1] },
    fill: { key: "#fff1dd", keyIntensity: 0, rim: "#ffffff", rimIntensity: 0 },
    shadow: "#17151a",
    lamps: 1.4,
  },
];

export function presetFor(id: string): LightingPreset {
  return lightingPresets.find((p) => p.id === id) ?? lightingPresets[1];
}

export function nextPreset(id: string): LightingPreset {
  const cycle = ["golden-hour", "daylight", "evening"];
  return presetFor(cycle[(cycle.indexOf(id) + 1) % cycle.length]);
}

/** The active preset: a view override if the user picked one, else the room's own. */
export function useLighting(): LightingPreset {
  const override = useStore(editor.interaction, (s) => s.lighting);
  const own = useStore(editor.scene, (s) => s.scene.lightingPreset);
  return presetFor(override ?? own);
}
