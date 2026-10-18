import { useEffect, useRef } from "react";
import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { editor } from "../state/editor";
/** Store changes schedule a frame; imperative drags schedule their own frames. */
export function IdleFrameloop() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const stores = [
      editor.scene,
      editor.draft,
      editor.interaction,
      editor.room,
    ];
    const unsub = stores.map((store) => store.subscribe(() => invalidate()));
    invalidate();
    return () => unsub.forEach((f) => f());
  }, [invalidate]);
  return null;
}
export function PerfProbe() {
  const gl = useThree((s) => s.gl),
    sample = useRef({ start: 0, count: 0, last: 0, rendered: false });
  useFrame(() => {
    sample.current.rendered = true;
  });
  useEffect(
    () =>
      addAfterEffect(() => {
        const s = sample.current;
        if (!s.rendered) return;
        s.rendered = false;
        const now = performance.now(),
          p = editor.motion.perf;
        if (now - s.last > 250) {
          s.start = now;
          s.count = 0;
        }
        s.last = now;
        s.count++;
        if (now - s.start >= 250) {
          p.fps = (s.count * 1000) / (now - s.start);
          s.count = 0;
          s.start = now;
        }
        p.frames++;
        p.lastFrameAt = now;
        p.drawCalls = gl.info.render.calls;
        p.triangles = gl.info.render.triangles;
      }),
    [gl],
  );
  return null;
}
