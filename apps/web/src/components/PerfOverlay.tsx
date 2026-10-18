import { useEffect, useRef } from "react";
import { editor } from "../state/editor";
export function PerfOverlay() {
  const ref = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const update = () => {
      const p = editor.motion.perf;
      if (ref.current)
        ref.current.textContent = `${performance.now() - p.lastFrameAt > 500 ? "Idle" : `${Math.round(p.fps)} rendered fps`} · ${p.drawCalls} draws · ${Math.round(p.triangles / 1000)}k triangles`;
    };
    update();
    const id = setInterval(update, 300);
    return () => clearInterval(id);
  }, []);
  return (
    <output
      className="perf-probe glass"
      ref={ref}
      aria-label="Rendering performance"
    />
  );
}
