import { useEffect, useSyncExternalStore } from 'react';
import { useProgress } from '@react-three/drei';
import { boxSelect } from '../scene/interaction/boxSelect';
import { referenceImage } from '../state/loader';
import { useEditor } from '../state/store';
import test2Url from '../../../../assets/test2.png?url';

/** Map repo-relative reference paths to bundled URLs (dev/demo tool). */
const REFERENCES: Record<string, string> = { 'assets/test2.png': test2Url };

/** Shift+drag selection rectangle. */
export function BoxSelectRect() {
  const r = useSyncExternalStore(boxSelect.subscribe, boxSelect.get);
  if (!r) return null;
  return (
    <div
      className="box-select"
      style={{ left: Math.min(r.x0, r.x1), top: Math.min(r.y0, r.y1), width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0) }}
    />
  );
}

/**
 * Reference-image overlay (dev/demo): picture-in-picture, or full-screen over the canvas with an
 * opacity slider, for comparing the reproduced room with the photo at the "Match photo" camera.
 */
export function ReferenceOverlay() {
  const ref = useEditor((s) => s.reference);
  useEditor((s) => s.source); // re-render when the scene (and its reference) changes
  const url = referenceImage.current ? REFERENCES[referenceImage.current] : undefined;
  if (!url || !ref.open) return null;
  const set = (patch: Partial<typeof ref>) => useEditor.setState({ reference: { ...ref, ...patch } });
  return (
    <>
      {ref.mode === 'full' && <img className="reference-full" src={url} alt="Reference photo" style={{ opacity: ref.opacity }} />}
      <div className={`reference-panel panel ${ref.mode}`}>
        {ref.mode === 'pip' && <img src={url} alt="Reference photo" />}
        <div className="reference-controls">
          <div className="segmented small">
            <button className={ref.mode === 'pip' ? 'on' : ''} onClick={() => set({ mode: 'pip' })}>Side by side</button>
            <button className={ref.mode === 'full' ? 'on' : ''} onClick={() => set({ mode: 'full' })}>Overlay</button>
          </div>
          {ref.mode === 'full' && (
            <label className="slider">
              Opacity
              <input type="range" min={0} max={1} step={0.05} value={ref.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
            </label>
          )}
          <button className="btn small" onClick={() => set({ open: false })}>Close</button>
        </div>
      </div>
    </>
  );
}

export const hasReference = () => !!(referenceImage.current && REFERENCES[referenceImage.current]);

/**
 * Exposes `window.__houseReady` once the scene's assets have finished loading (used by the
 * headless capture script; harmless otherwise).
 */
export function ReadyFlag() {
  const { active, loaded, total } = useProgress();
  const hasScene = useEditor((s) => !!s.workingScene);
  useEffect(() => {
    const w = window as unknown as { __houseReady?: boolean };
    w.__houseReady = false;
    if (!hasScene || active || loaded < total) return;
    // Give Suspense boundaries and shadows a couple of frames to settle.
    const t = setTimeout(() => { w.__houseReady = true; }, 1200);
    return () => clearTimeout(t);
  }, [active, loaded, total, hasScene]);
  return null;
}
