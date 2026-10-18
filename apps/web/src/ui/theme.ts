import { useEffect } from 'react';
import { presetOf, type LightingPreset } from '../scene/Lighting';
import { useEditor } from '../state/store';

/**
 * UI theme per lighting preset: the glass stays warm and light; the accent and the page backdrop
 * follow the room's light (matching the 3D background in Lighting.tsx).
 */
export const THEMES: Record<LightingPreset, { label: string; accent: string; accentInk: string; backdrop: string; glass: string; glassStrong: string }> = {
  day: { label: 'Daylight', accent: '#c96a34', accentInk: '#ffffff', backdrop: '#e8e1d6', glass: 'rgba(255, 249, 241, 0.6)', glassStrong: 'rgba(255, 251, 245, 0.82)' },
  golden: { label: 'Golden hour', accent: '#d9742f', accentInk: '#ffffff', backdrop: '#d9c6a6', glass: 'rgba(255, 249, 241, 0.6)', glassStrong: 'rgba(255, 251, 245, 0.82)' },
  // Over the dark evening backdrop the glass stays light by being more opaque.
  evening: { label: 'Evening', accent: '#c4693d', accentInk: '#ffffff', backdrop: '#2b2420', glass: 'rgba(255, 249, 241, 0.84)', glassStrong: 'rgba(255, 251, 245, 0.92)' },
};

export const PRESET_ORDER: LightingPreset[] = ['day', 'golden', 'evening'];

export function useLightingPreset(): LightingPreset {
  return presetOf(useEditor((s) => s.workingScene?.lightingPreset));
}

/** Writes the active theme onto :root. */
export function ThemeSync() {
  const preset = useLightingPreset();
  useEffect(() => {
    const t = THEMES[preset];
    const root = document.documentElement.style;
    root.setProperty('--accent', t.accent);
    root.setProperty('--accent-ink', t.accentInk);
    root.setProperty('--backdrop', t.backdrop);
    root.setProperty('--glass-fill', t.glass);
    root.setProperty('--glass-fill-strong', t.glassStrong);
  }, [preset]);
  return null;
}
