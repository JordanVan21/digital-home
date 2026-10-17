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
    id: "golden-hour",
    label: "Golden hour",
    accent: "#d9742f",
    accentInk: "#ffffff",
    backdrop: "#e9e6df",
    ambient: 0.45,
    hemisphere: { sky: "#fff1da", ground: "#c3b7a0", intensity: 1.3 },
    sun: { color: "#ffe3b5", intensity: 3.5, position: [-3.5, 7, 2] },
    fill: {
      key: "#fff2dc",
      keyIntensity: 2.5,
      rim: "#eef0ff",
      rimIntensity: 1.3,
    },
    shadow: "#77634f",
    lamps: 1,
  },
  {
    id: "daylight",
    label: "Daylight",
    accent: "#2b2e33",
    accentInk: "#ffffff",
    backdrop: "#eceeef",
    ambient: 0.6,
    hemisphere: { sky: "#ffffff", ground: "#cfd3d6", intensity: 1.2 },
    sun: { color: "#ffffff", intensity: 3, position: [-2.5, 8, 3.5] },
    fill: {
      key: "#ffffff",
      keyIntensity: 2.2,
      rim: "#f3f6ff",
      rimIntensity: 1.4,
    },
    shadow: "#5d6166",
    lamps: 0,
  },
  {
    id: "overcast",
    label: "Overcast",
    accent: "#4d6b8c",
    accentInk: "#ffffff",
    backdrop: "#e1e5e9",
    ambient: 0.7,
    hemisphere: { sky: "#e8eef6", ground: "#b8bfc6", intensity: 1.25 },
    sun: { color: "#dfe8f5", intensity: 2, position: [-2, 9, 1] },
    fill: {
      key: "#e9f0ff",
      keyIntensity: 2,
      rim: "#dfe6f2",
      rimIntensity: 1.6,
    },
    shadow: "#55606b",
    lamps: 0.4,
  },
];

export function presetFor(id: string): LightingPreset {
  return lightingPresets.find((p) => p.id === id) ?? lightingPresets[0];
}

export function nextPreset(id: string): LightingPreset {
  const i = lightingPresets.findIndex((p) => p.id === id);
  return lightingPresets[(i + 1) % lightingPresets.length];
}

/** The active preset: a view override if the user picked one, else the room's own. */
export function useLighting(): LightingPreset {
  const override = useStore(editor.interaction, (s) => s.lighting);
  const own = useStore(editor.scene, (s) => s.scene.lightingPreset);
  return presetFor(override ?? own);
}
