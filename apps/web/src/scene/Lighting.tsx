import { useLayoutEffect, useMemo, useRef } from 'react';
import { Environment } from '@react-three/drei';
import type { DirectionalLight } from 'three';
import type { RoomShell } from '@house/contracts';
import { polygonBounds, wallFrames } from '@house/scene-engine';
import { useEditor } from '../state/store';

/**
 * Scene lighting presets. Everything is local (CC0 HDRs in public/hdr — never Drei presets, which
 * download from a CDN). One shadow-casting directional "sun" whose shadow camera is fitted to the
 * room; for 'golden' the sun comes in low through the room's largest glazed opening.
 */
export type LightingPreset = 'day' | 'golden' | 'evening';

const PRESETS: Record<LightingPreset, {
  hdr: string; envIntensity: number; background: boolean; blur: number; bgIntensity: number;
  sun: { color: string; intensity: number; elevationDeg: number }; hemi: number; bg: string;
}> = {
  day: { hdr: '/hdr/warm-interior.hdr', envIntensity: 0.6, background: false, blur: 0, bgIntensity: 1, sun: { color: '#ffe8cc', intensity: 2.4, elevationDeg: 48 }, hemi: 0.35, bg: '#1d1e22' },
  golden: { hdr: '/hdr/golden-garden.hdr', envIntensity: 0.5, background: false, blur: 0, bgIntensity: 1, sun: { color: '#ffa95c', intensity: 4.6, elevationDeg: 20 }, hemi: 0.32, bg: '#cdbca1' },
  evening: { hdr: '/hdr/warm-interior.hdr', envIntensity: 0.12, background: false, blur: 0, bgIntensity: 1, sun: { color: '#8fa4c8', intensity: 0.25, elevationDeg: 30 }, hemi: 0.06, bg: '#121318' },
};

/** Ground tone outside the room per preset. */
export const GROUND_COLOR: Record<LightingPreset, string> = { day: '#2a2a2c', golden: '#c2ae90', evening: '#18191d' };

export const presetOf = (name: string | undefined): LightingPreset =>
  name === 'golden' || name === 'evening' ? name : 'day';

export function Lighting({ shell }: { shell: RoomShell }) {
  const preset = presetOf(useEditor((s) => s.workingScene?.lightingPreset));
  const p = PRESETS[preset];
  const sun = useRef<DirectionalLight>(null);
  const frame = useMemo(() => {
    const b = polygonBounds(shell.floor.polygonXZ);
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[1] + b.max[1]) / 2;
    const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 + 0.8;
    // Main light opening: the widest glazed door/window (else any window); the sun shines in through it.
    const frames = new Map(wallFrames(shell).map((f) => [f.wall.id, f]));
    const openings = [...shell.openings].sort((a, b) => (b.glazing ? 10 : 0) + b.widthM - ((a.glazing ? 10 : 0) + a.widthM));
    const main = openings.find((o) => o.kind !== 'opening' && frames.has(o.wallId));
    const inward: [number, number] = main ? frames.get(main.wallId)!.inward : [0.55, 0.83];
    return { cx, cz, r, inward };
  }, [shell]);

  const sunPos = useMemo(() => {
    const el = (p.sun.elevationDeg * Math.PI) / 180;
    const dist = 12;
    // Sun outside the main opening, slightly off-axis so mullion shadows rake across the floor.
    const ax = -frame.inward[0] + frame.inward[1] * 0.35;
    const az = -frame.inward[1] - frame.inward[0] * 0.35;
    const n = Math.hypot(ax, az) || 1;
    return [frame.cx + (ax / n) * dist * Math.cos(el), dist * Math.sin(el), frame.cz + (az / n) * dist * Math.cos(el)] as const;
  }, [frame, p.sun.elevationDeg]);

  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cam = l.shadow.camera;
    const r = frame.r * (preset === 'golden' ? 1.6 : 1);
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0.5; cam.far = 40;
    cam.updateProjectionMatrix();
    l.target.position.set(frame.cx, 0, frame.cz);
    l.target.updateMatrixWorld();
    l.shadow.needsUpdate = true;
  }, [frame, preset, sunPos]);

  return (
    <>
      {!p.background && <color attach="background" args={[p.bg]} />}
      {/* Soft fade of the surroundings into the backdrop (stands in for test2's tilt-shift blur). */}
      <fog attach="fog" args={[p.bg, 14, preset === 'golden' ? 32 : 45]} />
      <Environment
        key={p.hdr}
        files={p.hdr}
        environmentIntensity={p.envIntensity}
        background={p.background}
        backgroundBlurriness={p.blur}
        backgroundIntensity={p.bgIntensity}
      />
      <hemisphereLight args={[preset === 'golden' ? '#ffd2a0' : '#fff1dd', '#4a3626', p.hemi]} />
      <directionalLight
        ref={sun}
        position={sunPos as unknown as [number, number, number]}
        intensity={p.sun.intensity}
        color={p.sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={3}
      />
    </>
  );
}
