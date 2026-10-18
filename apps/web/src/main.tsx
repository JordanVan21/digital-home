import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AssetGallery } from './dev/AssetGallery';
import './styles.css';

// ?geometry-lab: codex's isolated shape inspection lab (baked shapes, probes, query benchmark).
const GeometryLab = lazy(() => import('./geometry-lab/GeometryLab'));
const params = new URLSearchParams(location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.has('geometry-lab') ? (
      <Suspense fallback={<p>Loading geometry experiment…</p>}><GeometryLab /></Suspense>
    ) : import.meta.env.DEV && params.has('gallery') ? <AssetGallery /> : <App />}
  </StrictMode>,
);
