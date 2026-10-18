import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useEditor } from '../state/store';

const IDLE_MS = 2500;

/**
 * Render continuously while anything is happening (pointer, wheel, keys, store changes, camera
 * transitions) and fall back to frameloop="demand" after a quiet period, so an idle editor costs
 * no GPU. Benchmarks can force continuous rendering with ?perf or ?frameloop=always.
 */
export function IdleFrameloop() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('perf') || q.get('frameloop') === 'always') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let mode: 'always' | 'demand' = 'always';
    const wake = () => {
      if (mode !== 'always') {
        mode = 'always';
        setFrameloop('always');
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (useEditor.getState().dragging || useEditor.getState().walkMode) return wake();
        mode = 'demand';
        setFrameloop('demand');
        invalidate();
      }, IDLE_MS);
    };
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'resize'] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    const unsub = useEditor.subscribe(wake);
    wake();
    return () => {
      events.forEach((e) => window.removeEventListener(e, wake));
      unsub();
      if (timer) clearTimeout(timer);
      setFrameloop('always');
    };
  }, [setFrameloop, invalidate]);
  return null;
}
