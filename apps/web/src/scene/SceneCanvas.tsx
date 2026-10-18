import { lazy, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import { useEditor } from '../state/store';
import { CameraRig } from './CameraRig';
import { CanvasBridge } from './canvasBridge';
import { InteractionLayer } from './interaction/InteractionLayer';
import { Lighting } from './Lighting';
import { RoomShellMesh } from './RoomShellMesh';
import { SceneObjects } from './SceneObjectMesh';
import { SelectionOverlay } from './SelectionOverlay';
import { TransformControlsWrapper } from './TransformControlsWrapper';
import { PerfProbe } from './PerfProbe';
import { IdleFrameloop } from './IdleFrameloop';

// Dev-only frame stats (?perf in the URL); never bundled into production code paths.
const Perf = import.meta.env.DEV ? lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf }))) : null;
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const showPerf = params.has('perf');

export function SceneCanvas() {
  const shell = useEditor((s) => s.shell);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 45, near: 0.05, far: 200, position: [6, 6, 6] }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, preserveDrawingBuffer: params.has('capture') }}
    >
      {shell && (
        <>
          <Suspense fallback={null}>
            <Lighting shell={shell} />
          </Suspense>
          <Suspense fallback={null}>
            <RoomShellMesh shell={shell} />
          </Suspense>
          <SceneObjects />
          <SelectionOverlay />
          <TransformControlsWrapper />
          <CameraRig shell={shell} />
          <InteractionLayer />
        </>
      )}
      <CanvasBridge />
      <IdleFrameloop />
      {import.meta.env.DEV && <PerfProbe />}
      {Perf && showPerf && (
        <Suspense fallback={null}>
          <Perf position="bottom-right" minimal />
        </Suspense>
      )}
    </Canvas>
  );
}
