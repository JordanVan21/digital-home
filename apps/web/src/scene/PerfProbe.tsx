import { useFrame, useThree } from '@react-three/fiber';

/**
 * Dev-only frame probe: exposes rolling frame stats on `window.__housePerf` so headless benchmarks
 * (and you, in the console) can read FPS / frame time / draw calls without r3f-perf's overlay.
 */
type Stats = { fps: number; frameMs: number; p95Ms: number; calls: number; triangles: number; frames: number; reset(): void };
declare global {
  interface Window { __housePerf?: Stats }
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const samples: number[] = [];
  let last = performance.now();
  const stats: Stats = {
    fps: 0, frameMs: 0, p95Ms: 0, calls: 0, triangles: 0, frames: 0,
    reset() { samples.length = 0; this.frames = 0; },
  };
  if (typeof window !== 'undefined') window.__housePerf = stats;
  useFrame(() => {
    const now = performance.now();
    samples.push(now - last);
    last = now;
    if (samples.length > 240) samples.shift();
    stats.frames++;
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    stats.frameMs = mean;
    stats.fps = 1000 / mean;
    stats.p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? mean;
    stats.calls = gl.info.render.calls;
    stats.triangles = gl.info.render.triangles;
  });
  return null;
}
