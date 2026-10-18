import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import type { AssetSpec } from '@house/contracts';
import { isNestingAllowed, polygonCentroid } from '@house/scene-engine';
import { cameraTargetFloorPoint } from '../scene/canvasBridge';
import { humanCategory } from '../scene/categoryColors';
import { addAsset, objectById, swapAsset, useEditor } from '../state/store';
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

/** The furniture library: add pieces (click, or drag into the room) or replace the selected model. */
export function AssetBrowser() {
  const open = useEditor((s) => s.libraryOpen);
  const replacing = useEditor((s) => s.replacing);
  const query = useEditor((s) => s.libraryQuery);
  const assets = useEditor((s) => s.assets);
  const catalog = useEditor((s) => s.catalog);
  const selected = useEditor((s) => (s.selectedId ? s.workingScene?.objects.find((o) => o.id === s.selectedId) : undefined));
  const [category, setCategory] = useState('all');
  const [dragging, setDragging] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const verified = useMemo(() => assets.filter((a) => a.licenseStatus === 'verified'), [assets]);
  const categories = useMemo(() => ['all', ...new Set(verified.map((a) => a.category))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b))), [verified]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return verified.filter((a) => (replacing ? a.category === selected?.category : category === 'all' || a.category === category)
      && (!q || `${a.title} ${a.searchableDescription} ${a.tags.join(' ')} ${a.styles.join(' ')}`.toLowerCase().includes(q)));
  }, [verified, category, query, replacing, selected?.category]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    if (previous?.id !== 'global-search') closeRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);
  if (!open) return null;
  const close = () => useEditor.setState({ libraryOpen: false, replacing: false });
  const choose = (a: AssetSpec) => {
    if (replacing && selected) swapAsset(selected.id, a.id);
    else addAtCameraTarget(a);
    close();
  };
  return (
    <div className={`browser-backdrop ${dragging ? 'is-dragging' : ''}`} onClick={close}>
      <section className="asset-browser glass" role="dialog" aria-modal="true" aria-label={replacing ? 'Replace model' : 'Furniture library'}
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
        <div className="browser-heading">
          <div>
            <span className="eyebrow">THE HOUSE COLLECTION</span>
            <h2>{replacing ? 'A fresh look for your piece.' : 'Find its place in your space.'}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" title="Close furniture library" aria-label="Close furniture library" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <div className="browser-filters">
          <label className="search-field">
            <Search size={16} />
            <input aria-label="Search furniture" placeholder="Search furniture…" value={query} onChange={(e) => useEditor.setState({ libraryQuery: e.target.value })} />
          </label>
          {!replacing && (
            <select aria-label="Furniture category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All pieces' : humanCategory(c)}</option>)}
            </select>
          )}
        </div>
        <div className="asset-grid">
          {shown.map((a) => {
            const thumb = catalog?.resolveThumbnailUrl(a.id);
            return (
              <button
                key={a.id}
                type="button"
                className="asset-card"
                title={replacing ? `Replace with ${a.title}` : `${a.title}: click to add, or drag into the room`}
                draggable={!replacing}
                onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG_MIME, a.id); e.dataTransfer.effectAllowed = 'copy'; setDragging(true); }}
                onDragEnd={() => { setDragging(false); close(); }}
                onClick={() => choose(a)}
              >
                <div className="asset-image">
                  {thumb ? <img loading="lazy" src={thumb} alt="" /> : null}
                  <span className="asset-arrow"><ArrowUpRight size={16} /></span>
                </div>
                <span className="asset-card-title">{a.title}</span>
                <span className="asset-meta">{formatDims(a.dimensionsM)}</span>
                <span className="asset-meta">{a.styles.slice(0, 2).join(' · ') || humanCategory(a.category)}</span>
                <span className="asset-price">{formatPrice(a)} {a.estimatedPrice && <small>est.</small>}</span>
              </button>
            );
          })}
        </div>
        {!shown.length && <div className="empty-state">No pieces found. Try another search.</div>}
        <p className="browser-note">
          {replacing ? 'Keeps the position and rotation of your piece. ' : 'Drag a piece to where you want it, or click to place it in view. '}
          New pieces arrive as suggestions; prices are rough catalog estimates.
        </p>
      </section>
    </div>
  );
}
