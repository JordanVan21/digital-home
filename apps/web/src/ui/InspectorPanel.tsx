import { useEffect, useMemo, useState } from 'react';
import type { AssetSpec, RenovationDecision, SceneObject, Tilt, Vec3 } from '@house/contracts';
import { areaXZ, classOf, isTiltable, lockedAspect, rankByDimensionFit, yawFromQuat } from '@house/scene-engine';
import {
  deleteSelected, duplicateSelected, groupSelected, opContext, resizeObject, rotateSelectionBy, selectedObjects, setDecision,
  setPosition, setSceneSettings, setTilt, setVariant, setYaw, swapAsset, toggleLight, toggleLock, ungroupSelected, useEditor,
  type WallMode,
} from '../state/store';
import { humanCategory } from '../scene/categoryColors';
import { DEFAULT_WALL_COLOR, FLOOR_MATERIALS } from '../scene/RoomShellMesh';
import { presetOf } from '../scene/Lighting';
import { Icon } from './icons';

const cm = (m: number) => `${Math.round(m * 100)}`;
export const formatDims = ([w, h, d]: readonly number[]) => `${cm(w!)} × ${cm(d!)} × ${cm(h!)} cm`;
export const formatPrice = (a: AssetSpec) =>
  a.estimatedPrice ? `~$${(a.estimatedPrice.minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Price unknown';

const SOURCE_LABEL: Record<SceneObject['source'], string> = {
  roomplan_approximation: 'From your scan',
  catalog: 'Added from library',
  user: 'Added by you',
  agent: 'Suggested by AI',
};
const DEG = Math.PI / 180;
const WALL_COLORS = ['#ece6dc', '#efe6da', '#f5f1ea', '#e4ddd2', '#d9d3c7', '#cfd6cf', '#e8d9c7'];

function DecisionPicker({ obj }: { obj: SceneObject }) {
  const options: { v: RenovationDecision | null; label: string }[] = [
    { v: null, label: 'Undecided' }, { v: 'keep', label: 'Keep this' }, { v: 'replace', label: 'Replace this' }, { v: 'remove', label: 'Remove' },
  ];
  return (
    <div className="field">
      <div className="field-label">Plan</div>
      <div className="segmented small" role="radiogroup" aria-label="Renovation decision">
        {options.map((o) => (
          <button key={o.label} role="radio" aria-checked={(obj.renovationDecision ?? null) === o.v}
            className={(obj.renovationDecision ?? null) === o.v ? 'on' : ''} onClick={() => setDecision(obj.id, o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="hint">Planning only — independent of the lock. Remove shows the item ghosted.</div>
    </div>
  );
}

function SwapPicker({ obj, onClose }: { obj: SceneObject; onClose: () => void }) {
  const catalog = useEditor((s) => s.catalog);
  const assets = useEditor((s) => s.assets);
  const ranked = useMemo(() => rankByDimensionFit(assets, [obj.category], obj.dimensionsM), [assets, obj.category, obj.dimensionsM]);
  return (
    <div className="swap-picker">
      <div className="swap-head">
        <span>Same-category models, best fit first</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.close /></button>
      </div>
      {ranked.length === 0 && <div className="hint">No verified models in this category yet.</div>}
      {ranked.map((r) => {
        const thumb = catalog?.resolveThumbnailUrl(r.asset.id);
        const current = r.asset.id === obj.assetId;
        return (
          <button key={r.asset.id} className={`swap-row ${current ? 'current' : ''}`} disabled={current} onClick={() => { swapAsset(obj.id, r.asset.id); onClose(); }}>
            {thumb ? <img src={thumb} alt="" /> : <div className="thumb-ph" />}
            <span className="swap-title">{r.asset.title}<small>{formatDims(r.asset.dimensionsM)}</small></span>
            <span className={`fit ${r.score > 0.85 ? 'good' : r.score > 0.65 ? 'ok' : 'poor'}`}>{current ? 'Current' : `${Math.round(r.score * 100)}% fit`}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Numeric input that commits on Enter / blur (never per keystroke). */
function NumField({ value, onCommit, step = 1, prefix, suffix, disabled, label }: {
  value: number; onCommit: (v: number) => void; step?: number; prefix?: string; suffix?: string; disabled?: boolean; label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <label className="toggle" title={label}>
      {prefix && <span className="axis">{prefix}</span>}
      <input className="num" type="number" step={step} value={text} disabled={disabled} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {suffix}
    </label>
  );
}

function TransformSection({ obj }: { obj: SceneObject }) {
  const ctx = opContext();
  const cls = ctx ? classOf(ctx, obj) : 'floor';
  const yawDeg = Math.round(yawFromQuat(obj.transform.rotation) / DEG);
  const [x, y, z] = obj.transform.position;
  const floorY = ctx?.shell.floor.elevationY ?? 0;
  const parentName = useEditor((s) => (obj.placement?.parentId ? s.workingScene?.objects.find((o) => o.id === obj.placement!.parentId)?.displayName : undefined));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const at = (axis: 0 | 1 | 2, v: number) => setPosition(obj.id, obj.transform.position.map((p, i) => (i === axis ? v : p)) as Vec3);
  const resting = parentName ? `Resting on ${parentName}` : cls === 'wall' ? 'On the wall' : y - floorY < 0.005 ? 'On the floor' : `${Math.round((y - floorY) * 100)} cm above the floor`;
  return (
    <div className="field">
      <div className="field-label">Position & rotation</div>
      <div className="row xyz">
        <NumField label="X position (m)" prefix="X" step={0.01} value={r2(x)} disabled={obj.locked} onCommit={(v) => at(0, v)} />
        <NumField label="Y position: height (m)" prefix="Y" step={0.01} value={r2(y)} disabled={obj.locked || cls === 'wall'} onCommit={(v) => at(1, v)} />
        <NumField label="Z position (m)" prefix="Z" step={0.01} value={r2(z)} disabled={obj.locked} onCommit={(v) => at(2, v)} />
        <span className="unit">m</span>
      </div>
      <div className="hint">{resting}</div>
      {cls !== 'wall' && (
        <div className="row">
          <button className="btn small" disabled={obj.locked} onClick={() => rotateSelectionBy(15 * DEG)} title="Rotate left (Q)">⟲ 15°</button>
          <NumField label="Yaw (degrees)" value={yawDeg} suffix="°" disabled={obj.locked} onCommit={(v) => setYaw(obj.id, v * DEG)} />
          <button className="btn small" disabled={obj.locked} onClick={() => rotateSelectionBy(-15 * DEG)} title="Rotate right (E)">15° ⟳</button>
        </div>
      )}
    </div>
  );
}

const TILTS: { label: string; tilt: Tilt }[] = [
  { label: 'Upright', tilt: { x: 0, z: 0 } },
  { label: 'Lay flat', tilt: { x: 1, z: 0 } },
  { label: 'On its side', tilt: { x: 0, z: 1 } },
  { label: 'Face down', tilt: { x: 3, z: 0 } },
];

function DecorOrientation({ obj, asset }: { obj: SceneObject; asset?: AssetSpec }) {
  if (!isTiltable(obj.category, asset)) return null;
  const cur = obj.tilt ?? { x: 0, z: 0 };
  return (
    <div className="field">
      <div className="field-label">Decor orientation</div>
      <div className="segmented small">
        {TILTS.map((t) => (
          <button key={t.label} disabled={obj.locked} className={cur.x === t.tilt.x && cur.z === t.tilt.z ? 'on' : ''} onClick={() => setTilt(obj.id, t.tilt)}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}

function SizeSection({ obj }: { obj: SceneObject }) {
  const [lock, setLock] = useState(true);
  const [w, h, d] = obj.dimensionsM;
  const apply = (axis: 0 | 1 | 2, cmValue: number) => {
    const v = Math.max(0.01, cmValue / 100);
    const next: Vec3 = lock ? lockedAspect(obj.dimensionsM, axis, v) : (obj.dimensionsM.map((x, i) => (i === axis ? v : x)) as Vec3);
    resizeObject(obj.id, next.map((x) => Math.round(x * 1000) / 1000) as Vec3);
  };
  return (
    <div className="field">
      <div className="field-label">Size (cm)</div>
      <div className="row">
        <NumField label="Width (cm)" value={Math.round(w * 100)} suffix="W" disabled={obj.locked} onCommit={(v) => apply(0, v)} />
        <NumField label="Depth (cm)" value={Math.round(d * 100)} suffix="D" disabled={obj.locked} onCommit={(v) => apply(2, v)} />
        <NumField label="Height (cm)" value={Math.round(h * 100)} suffix="H" disabled={obj.locked} onCommit={(v) => apply(1, v)} />
      </div>
      <label className="toggle"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions</label>
      <div className="hint">Models scale uniformly; non-uniform sizes beyond ±15% fit the model inside the box rather than stretch it.</div>
    </div>
  );
}

function Variants({ obj, asset }: { obj: SceneObject; asset?: AssetSpec }) {
  if (!asset?.variants?.length) return null;
  const key = (o: SceneObject['materialOverrides']) => JSON.stringify(o ?? null);
  const current = key(obj.materialOverrides);
  return (
    <div className="field">
      <div className="field-label">Finish</div>
      <div className="swatches">
        {asset.variants.map((v, i) => {
          const on = current === key(v.overrides) || (i === 0 && !obj.materialOverrides);
          return (
            <button key={v.id} className={`swatch ${on ? 'on' : ''}`} style={{ background: v.swatch }} title={v.name} aria-label={v.name} aria-pressed={on}
              disabled={obj.locked} onClick={() => setVariant(obj.id, i === 0 ? null : v.overrides)} />
          );
        })}
      </div>
    </div>
  );
}

function SelectedObject({ obj }: { obj: SceneObject }) {
  const catalog = useEditor((s) => s.catalog);
  const violations = useEditor((s) => s.violations[obj.id]);
  const [swapOpen, setSwapOpen] = useState(false);
  const asset = obj.assetId ? catalog?.get(obj.assetId) : undefined;
  return (
    <>
      <div className="inspector-title">
        <div>
          <h2>{obj.displayName}</h2>
          <div className="sub"><span className="cat">{humanCategory(obj.category)}</span> · {SOURCE_LABEL[obj.source]}{obj.groupId ? ' · grouped' : ''}</div>
        </div>
        <button className={`lock-toggle ${obj.locked ? 'on' : ''}`} onClick={() => toggleLock(obj.id)} aria-pressed={obj.locked} title="Lock (L)">
          {obj.locked ? <Icon.lock /> : <Icon.unlock />}{obj.locked ? 'Locked' : 'Unlocked'}
        </button>
      </div>
      {obj.locked && <div className="note">Locked items can't be moved, rotated, swapped or deleted — by you or by AI.</div>}

      <div className="field">
        <div className="field-label">Model</div>
        <div className="model-row">
          {asset && catalog?.resolveThumbnailUrl(asset.id) ? <img src={catalog.resolveThumbnailUrl(asset.id)!} alt="" /> : <div className="thumb-ph" />}
          <div>
            <div>{asset ? asset.title : 'Approximate placeholder'}</div>
            <small>{asset ? `${formatPrice(asset)} · ${asset.license ?? asset.licenseStatus}` : obj.scanMatch ? 'No close match in the library' : 'No model'}</small>
          </div>
        </div>
        {obj.scanMatch && <small className="hint">Scanned as “{obj.scanMatch.roomPlanCategory}” · match {Math.round(obj.scanMatch.score * 100)}%</small>}
        <div className="row">
          <button className="btn" disabled={obj.locked} onClick={() => setSwapOpen((v) => !v)}><Icon.swap /> Swap model</button>
          {asset?.light && (
            <button className={`btn ${obj.lightOn === false ? '' : 'on'}`} onClick={() => toggleLight(obj.id)}>{obj.lightOn === false ? 'Light off' : 'Light on'}</button>
          )}
        </div>
        {swapOpen && !obj.locked && <SwapPicker obj={obj} onClose={() => setSwapOpen(false)} />}
      </div>

      <Variants obj={obj} asset={asset} />
      <TransformSection obj={obj} />
      <DecorOrientation obj={obj} asset={asset} />
      <SizeSection obj={obj} />
      <DecisionPicker obj={obj} />

      {violations && violations.length > 0 && (
        <div className="field">
          <div className="field-label">Placement warnings</div>
          <ul className="violations">
            {violations.map((v, i) => <li key={i} className={v.severity}>{v.detail}</li>)}
          </ul>
        </div>
      )}

      <div className="actions">
        <button className="btn" onClick={duplicateSelected}><Icon.duplicate /> Duplicate</button>
        <button className="btn danger" disabled={obj.locked} onClick={deleteSelected}><Icon.trash /> Delete</button>
      </div>
      {/* Must match the keys in sessions.ts / useKeyboardShortcuts.ts (MERGE_INVENTORY §10, decided key map). */}
      <div className="hint">
        Drag to move · hold <span className="kbd">Space</span> while dragging to move up/down (or <span className="kbd">Scroll</span>) ·
        {' '}<span className="kbd">R</span> then drag inside the ring to turn · <span className="kbd">Shift</span> 10 cm grid ·
        {' '}<span className="kbd">Alt</span> no snapping · <span className="kbd">Ctrl</span> (or <span className="kbd">C</span>) ignores collisions
      </div>
    </>
  );
}

function MultiSelection({ objs }: { objs: SceneObject[] }) {
  const grouped = objs.some((o) => o.groupId);
  const sameGroup = grouped && objs.every((o) => o.groupId === objs[0]!.groupId);
  return (
    <>
      <div className="inspector-title"><div><h2>{objs.length} items</h2><div className="sub">{sameGroup ? 'Group' : 'Selection'}</div></div></div>
      <ul className="violations">{objs.slice(0, 8).map((o) => <li key={o.id}>{o.displayName}</li>)}{objs.length > 8 && <li>…</li>}</ul>
      <div className="row">
        {!sameGroup && <button className="btn" onClick={groupSelected}>Group <span className="kbd">Ctrl+G</span></button>}
        {grouped && <button className="btn" onClick={ungroupSelected}>Ungroup</button>}
        <button className="btn" onClick={() => toggleLock()}><Icon.lock /> Lock / unlock</button>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => rotateSelectionBy(15 * DEG)}>⟲ 15°</button>
        <button className="btn small" onClick={() => rotateSelectionBy(-15 * DEG)}>15° ⟳</button>
      </div>
      <div className="actions">
        <button className="btn" onClick={duplicateSelected}><Icon.duplicate /> Duplicate</button>
        <button className="btn danger" onClick={deleteSelected}><Icon.trash /> Delete</button>
      </div>
      <div className="hint">Drag any selected item to move them together; collisions apply to the group as a whole.</div>
    </>
  );
}

function RoomInfo() {
  const shell = useEditor((s) => s.shell);
  const scene = useEditor((s) => s.workingScene);
  const roomName = useEditor((s) => s.roomName);
  const wallMode = useEditor((s) => s.wallMode);
  const showAllOutlines = useEditor((s) => s.showAllOutlines);
  const releaseMode = useEditor((s) => s.releaseMode);
  const flagged = useEditor((s) => Object.keys(s.violations).length);
  if (!shell || !scene) return null;
  const openings = shell.openings.reduce<Record<string, number>>((m, o) => ({ ...m, [o.kind]: (m[o.kind] ?? 0) + 1 }), {});
  const appearance = scene.appearance ?? {};
  const preset = presetOf(scene.lightingPreset);
  const setLook = (patch: Partial<typeof appearance>) => setSceneSettings({ appearance: { ...appearance, ...patch } });
  return (
    <>
      <div className="inspector-title"><div><h2>{roomName}</h2><div className="sub">Room</div></div></div>
      <div className="field grid2">
        <div><div className="field-label">Floor area</div>{areaXZ(shell.floor.polygonXZ).toFixed(1)} m²</div>
        <div><div className="field-label">Ceiling</div>{(shell.ceilingHeightM ?? shell.walls[0]?.heightM ?? 0).toFixed(2)} m</div>
        <div><div className="field-label">Openings</div>{Object.entries(openings).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}</div>
        <div><div className="field-label">Items</div>{scene.objects.length}{flagged ? ` · ${flagged} flagged` : ''}</div>
      </div>
      <div className="field">
        <div className="field-label">Lighting</div>
        <div className="segmented small">
          {(['day', 'golden', 'evening', 'overcast'] as const).map((p) => (
            <button key={p} className={preset === p ? 'on' : ''} onClick={() => setSceneSettings({ lightingPreset: p })}>{p === 'golden' ? 'Golden hour' : p[0]!.toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field-label">Walls nearest the camera</div>
        <div className="segmented small">
          {(['cutaway', 'fade', 'full'] as WallMode[]).map((m) => (
            <button key={m} className={wallMode === m ? 'on' : ''} onClick={() => useEditor.setState({ wallMode: m })}>{m === 'cutaway' ? 'Cut away' : m === 'fade' ? 'Fade' : 'Show'}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field-label">Letting go (tryout)</div>
        <div className="segmented small" role="radiogroup" aria-label="What happens when you let go of a raised piece">
          {([['mix', 'Mix'], ['fall', 'Always fall'], ['stay', 'Never fall']] as const).map(([m, label]) => (
            <button key={m} role="radio" aria-checked={releaseMode === m} className={releaseMode === m ? 'on' : ''} onClick={() => useEditor.setState({ releaseMode: m })}>{label}</button>
          ))}
        </div>
        <div className="hint">
          {releaseMode === 'mix' ? 'Ordinary drags fall onto the surface below; pieces you raise on purpose (Space, scroll wheel, PageUp, typed Y) stay up.'
            : releaseMode === 'fall' ? 'Everything falls onto the surface below when you let go.'
              : 'Nothing falls: pieces stay exactly where you let go (codex).'}
        </div>
      </div>
      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={showAllOutlines} onChange={(e) => useEditor.setState({ showAllOutlines: e.target.checked })} />
          Show all outlines
        </label>
        <div className="hint">Draws every piece's shape. View only; it doesn't change what collides.</div>
      </div>
      <div className="field">
        <div className="field-label">Wall paint</div>
        <div className="swatches">
          {WALL_COLORS.map((c) => (
            <button key={c} className={`swatch ${(appearance.wallColor ?? DEFAULT_WALL_COLOR) === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Wall colour ${c}`} onClick={() => setLook({ wallColor: c })} />
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field-label">Floor</div>
        <div className="segmented small">
          {Object.entries(FLOOR_MATERIALS).map(([k, v]) => (
            <button key={k} className={(appearance.floorMaterial ?? 'oak') === k ? 'on' : ''} onClick={() => setLook({ floorMaterial: k })}>{v.label}</button>
          ))}
        </div>
        <div className="hint">Paint and finishes are per scene; the scanned walls, doors and windows themselves can't be edited.</div>
      </div>
      <div className="hint">Click furniture to select · Shift-click / Shift-drag for several · double-click to focus · <span className="kbd">F</span> frame · <span className="kbd">Home</span> room · <span className="kbd">P</span> walk</div>
    </>
  );
}

export function InspectorPanel() {
  const open = useEditor((s) => s.inspectorOpen);
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.workingScene?.objects);
  const sel = useMemo(() => (objects ? selectedObjects() : []), [objects, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const primary = sel.find((o) => o.id === selectedIds[selectedIds.length - 1]);
  return (
    <aside className={`inspector panel ${open ? '' : 'collapsed'}`} aria-label="Inspector">
      <button className="collapse" onClick={() => useEditor.setState({ inspectorOpen: !open })} aria-expanded={open}>
        {open ? 'Hide' : 'Inspector'} <Icon.chevron open={open} />
      </button>
      {open && (
        <div className="inspector-body">
          {sel.length > 1 ? <MultiSelection objs={sel} /> : primary ? <SelectedObject key={primary.id} obj={primary} /> : <RoomInfo />}
        </div>
      )}
    </aside>
  );
}
