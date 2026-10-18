import { useMemo, useState } from 'react';
import type { AssetSpec } from '@house/contracts';
import { isNestingAllowed, polygonCentroid } from '@house/scene-engine';
import { cameraTargetFloorPoint } from '../scene/canvasBridge';
import { humanCategory } from '../scene/categoryColors';
import { addAsset, objectById, useEditor } from '../state/store';
import { Icon } from './icons';
import { formatDims, formatPrice } from './InspectorPanel';

export const ASSET_DRAG_MIME = 'application/x-house-asset';

/** Click → place at the camera target (or on the selected surface if it can hold the item). */
function addAtCameraTarget(asset: AssetSpec) {
  const s = useEditor.getState();
  if (!s.shell) return;
  const selected = objectById(s.selectedId);
  const onSurface = selected && isNestingAllowed(asset.category, selected.category) ? selected : null;
  const point = onSurface
    ? ([onSurface.transform.position[0], onSurface.transform.position[2]] as [number, number])
    : cameraTargetFloorPoint() ?? polygonCentroid(s.shell.floor.polygonXZ);
  addAsset(asset.id, point, onSurface?.id ?? null);
}

export function AssetBrowser() {
  const open = useEditor((s) => s.libraryOpen);
  const assets = useEditor((s) => s.assets);
  const catalog = useEditor((s) => s.catalog);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const verified = useMemo(() => assets.filter((a) => a.licenseStatus === 'verified'), [assets]);
  const categories = useMemo(() => [...new Set(verified.map((a) => a.category))].sort(), [verified]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return verified.filter((a) => (!category || a.category === category) && (!q || a.searchableDescription.toLowerCase().includes(q) || a.title.toLowerCase().includes(q)));
  }, [verified, category, query]);

  if (!open) return null;
  return (
    <section className="library panel" aria-label="Furniture library">
      <div className="library-head">
        <h2>Add furniture</h2>
        <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the library" />
        <button className="icon-btn" onClick={() => useEditor.setState({ libraryOpen: false })} aria-label="Close library"><Icon.close /></button>
      </div>
      <div className="chips" role="toolbar" aria-label="Categories">
        <button className={!category ? 'on' : ''} onClick={() => setCategory(null)}>All</button>
        {categories.map((c) => (
          <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{humanCategory(c)}</button>
        ))}
      </div>
      <div className="cards">
        {shown.map((a) => {
          const thumb = catalog?.resolveThumbnailUrl(a.id);
          return (
            <button
              key={a.id}
              className="card"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG_MIME, a.id); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => addAtCameraTarget(a)}
              title={`${a.title} — click to add, or drag into the room`}
            >
              {thumb ? <img src={thumb} alt="" loading="lazy" /> : <div className="thumb-ph" />}
              <div className="card-title">{a.title}</div>
              <div className="card-meta">{formatDims(a.dimensionsM)}</div>
              <div className="card-meta styles">{a.styles.slice(0, 2).join(' · ')}</div>
              <div className={`card-price ${a.estimatedPrice ? '' : 'unknown'}`}>{formatPrice(a)}</div>
            </button>
          );
        })}
        {shown.length === 0 && <div className="hint">Nothing matches.</div>}
      </div>
      <div className="hint">Prices are rough catalog estimates, not live quotes.</div>
    </section>
  );
}
