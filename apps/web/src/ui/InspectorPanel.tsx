import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, Box, ChevronDown, Copy, Group, Lightbulb, LightbulbOff, LockKeyhole, LockKeyholeOpen, Trash2,
  TriangleAlert, Ungroup, X,
} from 'lucide-react';
import type { AssetSpec, RenovationDecision, SceneObject, Tilt, Vec3 } from '@house/contracts';
import { areaXZ, classOf, findSupport, isTiltable, lockedAspect, rankByDimensionFit, yawFromQuat } from '@house/scene-engine';
import {
  deleteSelected, duplicateSelected, groupSelected, opContext, resizeObject, rotateSelectionBy, selectedObjects, setDecision,
  setFloat, setPosition, setSceneSettings, setTilt, setVariant, setYaw, swapAsset, toggleLight, toggleLock, ungroupSelected,
  useEditor,
} from '../state/store';
import { humanCategory } from '../scene/categoryColors';
import { DEFAULT_WALL_COLOR, FLOOR_MATERIALS } from '../scene/RoomShellMesh';
import { Button } from './Button';
import { PRESET_ORDER, THEMES, useLightingPreset } from './theme';

const cm = (m: number) => `${Math.round(m * 100)}`;
export const formatDims = ([w, h, d]: readonly number[]) => `${cm(w!)} × ${cm(d!)} × ${cm(h!)} cm`;
export const formatPrice = (a: AssetSpec) =>
  a.estimatedPrice ? `~$${(a.estimatedPrice.minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Price unknown';

const SOURCE_LABEL: Record<SceneObject['source'], string> = {
  roomplan_approximation: 'A close approximation from your scan',
  catalog: 'Added from the library',
  user: 'Added by you',
  agent: 'Suggested by AI',
};
const DEG = Math.PI / 180;
const WALL_COLORS = ['#ece6dc', '#efe6da', '#f5f1ea', '#e4ddd2', '#d9d3c7', '#cfd6cf', '#e8d9c7'];

/** Numeric field that commits on Enter / blur (never per keystroke) and resyncs from the scene. */
function NumInput({ value, onCommit, step = 0.01, digits = 2, disabled, label, className }: {
  value: number; onCommit: (v: number) => void; step?: number; digits?: number; disabled?: boolean; label: string; className?: string;
}) {
  const shown = Number(value.toFixed(digits));
  const [text, setText] = useState(String(shown));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(shown)); }, [shown, focused]);
  const commit = () => {
    setFocused(false);
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== shown) onCommit(v);
    else setText(String(shown));
  };
  return (
    <input
      className={className}
      type="number"
      step={step}
      value={text}
      disabled={disabled}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(String(shown)); e.currentTarget.blur(); } }}
    />
  );
}

function DecisionPicker({ obj }: { obj: SceneObject }) {
  const options: { v: RenovationDecision | null; label: string }[] = [
    { v: null, label: 'Undecided' }, { v: 'keep', label: 'Keep' }, { v: 'replace', label: 'Replace' }, { v: 'remove', label: 'Remove' },
  ];
  return (
    <section className="inspector-section">
      <h3>Plan <small>for your budget</small></h3>
      <div className="segmented" role="radiogroup" aria-label="Renovation decision">
        {options.map((o) => (
          <button key={o.label} role="radio" aria-checked={(obj.renovationDecision ?? null) === o.v}
            className={(obj.renovationDecision ?? null) === o.v ? 'on' : ''} onClick={() => setDecision(obj.id, o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="section-note">Planning only, independent of the lock. Remove shows the piece ghosted.</p>
    </section>
  );
}

function SwapPicker({ obj, onClose }: { obj: SceneObject; onClose: () => void }) {
  const catalog = useEditor((s) => s.catalog);
  const assets = useEditor((s) => s.assets);
  const ranked = useMemo(() => rankByDimensionFit(assets, [obj.category], obj.dimensionsM), [assets, obj.category, obj.dimensionsM]);
  return (
    <div className="swap-picker">
      <div className="swap-head">
        <span>Same kind of piece, best fit first</span>
        <Button label="Close" className="tiny-button" onClick={onClose}><X size={13} /></Button>
      </div>
      {ranked.length === 0 && <div className="section-note">No verified models in this category yet.</div>}
      {ranked.map((r) => {
        const thumb = catalog?.resolveThumbnailUrl(r.asset.id);
        const current = r.asset.id === obj.assetId;
        return (
          <button key={r.asset.id} className="swap-row" disabled={current} onClick={() => { swapAsset(obj.id, r.asset.id); onClose(); }}>
            {thumb ? <img src={thumb} alt="" /> : <div className="thumb-ph" />}
            <span className="swap-title">{r.asset.title}<small>{formatDims(r.asset.dimensionsM)} · {formatPrice(r.asset)}</small></span>
            <span className={`fit ${current ? 'good' : r.score > 0.85 ? 'good' : r.score > 0.65 ? 'ok' : 'poor'}`}>{current ? 'Current' : `${Math.round(r.score * 100)}% fit`}</span>
          </button>
        );
      })}
    </div>
  );
}

function PositionSection({ obj }: { obj: SceneObject }) {
  const ctx = opContext();
  const cls = ctx ? classOf(ctx, obj) : 'floor';
  const dragging = useEditor((s) => s.dragging);
  const mode = useEditor((s) => s.mode);
  const objects = useEditor((s) => s.workingScene?.objects);
  const disabled = obj.locked || dragging;
  const yaw = ((Math.round(yawFromQuat(obj.transform.rotation) / DEG) % 360) + 360) % 360;
  const parentName = obj.placement?.parentId ? objects?.find((o) => o.id === obj.placement!.parentId)?.displayName : undefined;
  const supportY = useMemo(() => {
    if (!ctx || !objects) return 0;
    return findSupport(objects.filter((o) => o.id !== obj.id), obj, { assets: ctx.assets, floorY: ctx.shell.floor.elevationY }, { maxY: obj.transform.position[1] }).y;
  }, [ctx, objects, obj]);
  const raised = obj.transform.position[1] > supportY + 0.005;
  return (
    <section className="inspector-section">
      <h3>Position <small>meters</small></h3>
      <div className="xyz-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <label key={axis} title={axis === 'Y' ? 'Height of the base above the floor' : `${axis} in room coordinates`}>
            {axis}
            <NumInput label={`${axis} position in meters`} value={obj.transform.position[i]!} disabled={disabled}
              onCommit={(v) => setPosition(obj.id, i as 0 | 1 | 2, v)} />
          </label>
        ))}
      </div>
      <p className="section-note">
        {parentName ? `Resting on ${parentName}. ` : ''}
        {cls === 'wall' ? 'Mounted on the wall.' : cls === 'ceiling' ? 'Hanging from the ceiling.'
          : obj.placement?.float ? 'Floating at this height.' : 'Snaps onto the surface below. Hold Alt while dragging to move freely.'}
      </p>
      {cls !== 'wall' && cls !== 'ceiling' && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={!!obj.placement?.float} disabled={disabled} onChange={(e) => setFloat(obj.id, e.target.checked)} />
            Float (don’t settle onto the surface below)
          </label>
          {(raised || obj.placement?.float) && (
            <div className="chip-row">
              <button className="chip-button" disabled={disabled} onClick={() => setFloat(obj.id, false)}>
                <ArrowDownToLine size={12} /> Place on {parentName ?? 'the floor'}
              </button>
            </div>
          )}
        </>
      )}
      {cls !== 'wall' && (
        <div className="rotation-readout">
          <label htmlFor={`rot-${obj.id}`}>Rotation</label>
          <NumInput className="rotation-input" label="Rotation in degrees" step={1} digits={0} value={yaw} disabled={disabled}
            onCommit={(v) => setYaw(obj.id, v * DEG)} />
          <span className="unit">°</span>
          <Button label="Rotate counterclockwise 15° (Q)" disabled={disabled} className="step-button" onClick={() => rotateSelectionBy(15 * DEG)}>−</Button>
          <Button label="Rotate clockwise 15° (E)" disabled={disabled} className="step-button" onClick={() => rotateSelectionBy(-15 * DEG)}>+</Button>
        </div>
      )}
      {mode === 'rotate' && !obj.locked && <p className="section-note">Drag inside the ring to rotate. Shift snaps to 15°.</p>}
    </section>
  );
}

function SizeSection({ obj, asset }: { obj: SceneObject; asset?: AssetSpec }) {
  const [lock, setLock] = useState(true);
  const dragging = useEditor((s) => s.dragging);
  const apply = (axis: 0 | 1 | 2, cmValue: number) => {
    const v = Math.max(0.01, cmValue / 100);
    const next: Vec3 = lock ? lockedAspect(obj.dimensionsM, axis, v) : (obj.dimensionsM.map((x, i) => (i === axis ? v : x)) as Vec3);
    resizeObject(obj.id, next.map((x) => Math.round(x * 1000) / 1000) as Vec3);
  };
  const fields: [string, 0 | 1 | 2][] = [['W', 0], ['D', 2], ['H', 1]];
  return (
    <section className="inspector-section">
      <h3>Dimensions <small>centimeters</small></h3>
      <div className="xyz-grid">
        {fields.map(([label, axis]) => (
          <label key={label}>
            {label}
            <NumInput label={`${label === 'W' ? 'Width' : label === 'D' ? 'Depth' : 'Height'} in centimeters`} step={1} digits={0}
              value={obj.dimensionsM[axis] * 100} disabled={obj.locked || dragging} onCommit={(v) => apply(axis, v)} />
          </label>
        ))}
      </div>
      <label className="check-row"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions</label>
      <div className="asset-source">
        <ArrowDownToLine size={13} />
        {asset ? (
          asset.sourceUrl
            ? <a href={asset.sourceUrl} target="_blank" rel="noreferrer">{asset.title} · {asset.license ?? asset.licenseStatus} ↗</a>
            : <span>{asset.title} · {asset.license ?? asset.licenseStatus}</span>
        ) : <span>{obj.scanMatch ? 'Scanned piece · no close match in the library' : 'Approximate placeholder'}</span>}
      </div>
    </section>
  );
}

const TILTS: { label: string; tilt: Tilt }[] = [
  { label: 'Upright', tilt: { x: 0, z: 0 } },
  { label: 'Lay flat', tilt: { x: 1, z: 0 } },
  { label: 'On its side', tilt: { x: 0, z: 1 } },
  { label: 'Face down', tilt: { x: 3, z: 0 } },
];

function LookSection({ obj, asset }: { obj: SceneObject; asset?: AssetSpec }) {
  const tiltable = isTiltable(obj.category, asset);
  const variants = asset?.variants ?? [];
  if (!variants.length && !tiltable && !asset?.light) return null;
  const key = (o: SceneObject['materialOverrides']) => JSON.stringify(o ?? null);
  const current = key(obj.materialOverrides);
  const tilt = obj.tilt ?? { x: 0, z: 0 };
  return (
    <section className="inspector-section">
      <h3>Look</h3>
      {variants.length > 0 && (
        <div className="swatches">
          {variants.map((v, i) => {
            const on = current === key(v.overrides) || (i === 0 && !obj.materialOverrides);
            return (
              <button key={v.id} className={`swatch ${on ? 'on' : ''}`} style={{ background: v.swatch }} title={v.name} aria-label={v.name} aria-pressed={on}
                disabled={obj.locked} onClick={() => setVariant(obj.id, i === 0 ? null : v.overrides)} />
            );
          })}
        </div>
      )}
      {(tiltable || asset?.light) && (
        <div className="chip-row">
          {tiltable && TILTS.map((t) => (
            <button key={t.label} className={`chip-button ${tilt.x === t.tilt.x && tilt.z === t.tilt.z ? 'on' : ''}`} disabled={obj.locked} onClick={() => setTilt(obj.id, t.tilt)}>{t.label}</button>
          ))}
          {asset?.light && (
            <button className={`chip-button ${obj.lightOn === false ? '' : 'on'}`} onClick={() => toggleLight(obj.id)}>
              {obj.lightOn === false ? <LightbulbOff size={12} /> : <Lightbulb size={12} />} {obj.lightOn === false ? 'Light off' : 'Light on'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function SelectedObject({ obj }: { obj: SceneObject }) {
  const catalog = useEditor((s) => s.catalog);
  const violations = useEditor((s) => s.violations[obj.id]);
  const conflicts = useEditor((s) => s.draft.conflicts[obj.id]);
  const dragging = useEditor((s) => s.dragging);
  const [swapOpen, setSwapOpen] = useState(false);
  const asset = obj.assetId ? catalog?.get(obj.assetId) : undefined;
  const thumb = asset ? catalog?.resolveThumbnailUrl(asset.id) : null;
  const conflictKeys = new Set(conflicts?.map((v) => `${v.rule}:${v.otherId ?? ''}`));
  const warnings = violations?.filter((v) => !conflictKeys.has(`${v.rule}:${v.otherId ?? ''}`)) ?? [];
  return (
    <>
      <div className="panel-heading">
        <span>Details</span>
        <Button label="Hide details" className="tiny-button" onClick={() => useEditor.setState({ inspectorOpen: false })}><X size={14} /></Button>
      </div>
      <div className="object-preview">
        {thumb ? <img src={thumb} alt={asset!.title} /> : <Box size={50} strokeWidth={1} />}
        <span className="category-chip">{humanCategory(obj.category)}</span>
      </div>
      <h2>{obj.displayName}</h2>
      <p className="subtle">
        {SOURCE_LABEL[obj.source]}{obj.groupId ? ' · grouped' : ''}
        {asset ? ` · ${formatPrice(asset)}` : ''}
      </p>
      {obj.scanMatch && <p className="subtle">Scanned as “{obj.scanMatch.roomPlanCategory}” · {Math.round(obj.scanMatch.score * 100)}% match</p>}
      <button className={`lock-control ${obj.locked ? 'is-locked' : ''}`} aria-label={obj.locked ? 'Unlock selected object' : 'Lock selected object'}
        aria-pressed={obj.locked} disabled={dragging} onClick={() => toggleLock(obj.id)}>
        {obj.locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}
        <span>{obj.locked ? 'Locked in place' : 'Free to move'}</span>
        <span className="toggle-track"><span /></span>
      </button>
      {obj.locked && <p className="locked-note">Locked pieces can't be moved, rotated, swapped or deleted, by you or by AI.</p>}
      {conflicts && conflicts.length > 0 && (
        <div className="conflict-note"><TriangleAlert size={13} /><span>{conflicts.map((v) => v.detail).join(' ')} Accept moves it to the nearest free spot.</span></div>
      )}

      <PositionSection obj={obj} />
      <SizeSection obj={obj} asset={asset} />
      <LookSection obj={obj} asset={asset} />
      <DecisionPicker obj={obj} />

      {warnings.length > 0 && (
        <section className="inspector-section">
          <h3>Placement notes</h3>
          <ul className="violations">{warnings.map((v, i) => <li key={i} className={v.severity}>{v.detail}</li>)}</ul>
        </section>
      )}

      <div className="inspector-actions">
        <Button label="Replace model" className="secondary-button" disabled={obj.locked || dragging} onClick={() => setSwapOpen((v) => !v)}>
          <ArrowLeftRight size={14} /> Replace model
        </Button>
        <Button label="Duplicate (⌘/Ctrl+D)" className="danger-button neutral" disabled={dragging} onClick={duplicateSelected}><Copy size={15} /></Button>
        <Button label="Delete selected object" className="danger-button" disabled={obj.locked || dragging} onClick={deleteSelected}><Trash2 size={15} /></Button>
      </div>
      {swapOpen && !obj.locked && <SwapPicker obj={obj} onClose={() => setSwapOpen(false)} />}
      <p className="panel-footnote">
        {obj.locked ? 'Unlock this piece to make changes.'
          : 'Drag to move · Space for height · Alt moves freely · Shift snaps to a 10 cm grid'}
      </p>
    </>
  );
}

function MultiSelection({ objs }: { objs: SceneObject[] }) {
  const grouped = objs.some((o) => o.groupId);
  const sameGroup = grouped && objs.every((o) => o.groupId === objs[0]!.groupId);
  const locked = objs.every((o) => o.locked);
  return (
    <>
      <div className="panel-heading">
        <span>{sameGroup ? 'Group' : 'Selection'}</span>
        <Button label="Hide details" className="tiny-button" onClick={() => useEditor.setState({ inspectorOpen: false })}><X size={14} /></Button>
      </div>
      <h2>{objs.length} pieces</h2>
      <ul className="multi-list">{objs.slice(0, 8).map((o) => <li key={o.id}>{o.displayName}</li>)}{objs.length > 8 && <li>…</li>}</ul>
      <button className={`lock-control ${locked ? 'is-locked' : ''}`} aria-pressed={locked} onClick={() => toggleLock()}>
        {locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}
        <span>{locked ? 'All locked' : 'Lock all'}</span>
        <span className="toggle-track"><span /></span>
      </button>
      <section className="inspector-section">
        <h3>Arrange</h3>
        <div className="chip-row">
          {!sameGroup && <button className="chip-button" onClick={groupSelected}><Group size={12} /> Group <span className="kbd">⌘G</span></button>}
          {grouped && <button className="chip-button" onClick={ungroupSelected}><Ungroup size={12} /> Ungroup</button>}
          <button className="chip-button" onClick={() => rotateSelectionBy(15 * DEG)}>⟲ 15°</button>
          <button className="chip-button" onClick={() => rotateSelectionBy(-15 * DEG)}>15° ⟳</button>
        </div>
      </section>
      <div className="inspector-actions">
        <Button label="Duplicate" className="secondary-button" onClick={duplicateSelected}><Copy size={14} /> Duplicate</Button>
        <Button label="Delete" className="danger-button" onClick={deleteSelected}><Trash2 size={15} /></Button>
      </div>
      <p className="panel-footnote">Drag any selected piece to move them together.</p>
    </>
  );
}

/** Room card (nothing selected): facts plus Jordan's lighting, walls, paint and floor. */
function RoomCard() {
  const shell = useEditor((s) => s.shell);
  const scene = useEditor((s) => s.workingScene);
  const roomName = useEditor((s) => s.roomName);
  const wallMode = useEditor((s) => s.wallMode);
  const flagged = useEditor((s) => Object.keys(s.violations).length);
  const preset = useLightingPreset();
  const [open, setOpen] = useState(true);
  if (!shell || !scene) return null;
  const openings = shell.openings.reduce<Record<string, number>>((m, o) => ({ ...m, [o.kind]: (m[o.kind] ?? 0) + 1 }), {});
  const appearance = scene.appearance ?? {};
  const setLook = (patch: Partial<typeof appearance>) => setSceneSettings({ appearance: { ...appearance, ...patch } });
  return (
    <aside className="inspector room-card glass" aria-label="Room">
      <div className="panel-heading">
        <span>Room</span>
        <Button label={open ? 'Collapse' : 'Expand'} className="tiny-button" onClick={() => setOpen(!open)}>
          <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </Button>
      </div>
      <h2 style={{ marginTop: 0 }}>{roomName}</h2>
      {open && (
        <>
          <div className="stat-grid">
            <div><span>Floor area</span>{areaXZ(shell.floor.polygonXZ).toFixed(1)} m²</div>
            <div><span>Ceiling</span>{(shell.ceilingHeightM ?? shell.walls[0]?.heightM ?? 0).toFixed(2)} m</div>
            <div><span>Openings</span>{Object.entries(openings).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}</div>
            <div><span>Pieces</span>{scene.objects.length}{flagged ? ` · ${flagged} flagged` : ''}</div>
          </div>
          <section className="inspector-section">
            <h3>Lighting</h3>
            <div className="segmented">
              {PRESET_ORDER.map((p) => (
                <button key={p} className={preset === p ? 'on' : ''} onClick={() => setSceneSettings({ lightingPreset: p })}>{THEMES[p].label}</button>
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <h3>Walls nearest the camera</h3>
            <div className="segmented">
              {(['cutaway', 'fade', 'full'] as const).map((m) => (
                <button key={m} className={wallMode === m ? 'on' : ''} onClick={() => useEditor.setState({ wallMode: m })}>{m === 'cutaway' ? 'Cut away' : m === 'fade' ? 'Fade' : 'Show'}</button>
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <h3>Wall paint</h3>
            <div className="swatches">
              {WALL_COLORS.map((c) => (
                <button key={c} className={`swatch ${(appearance.wallColor ?? DEFAULT_WALL_COLOR) === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Wall colour ${c}`} onClick={() => setLook({ wallColor: c })} />
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <h3>Floor</h3>
            <div className="segmented">
              {Object.entries(FLOOR_MATERIALS).map(([k, v]) => (
                <button key={k} className={(appearance.floorMaterial ?? 'oak') === k ? 'on' : ''} onClick={() => setLook({ floorMaterial: k })}>{v.label}</button>
              ))}
            </div>
            <p className="section-note">The scanned walls, doors and windows themselves can't be edited.</p>
          </section>
          <p className="panel-footnote">Click a piece to select · Shift-click or Shift-drag for several · double-click to focus · P to walk</p>
        </>
      )}
    </aside>
  );
}

export function InspectorPanel() {
  const open = useEditor((s) => s.inspectorOpen);
  const walk = useEditor((s) => s.walkMode);
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.workingScene?.objects);
  const sel = useMemo(() => (objects ? selectedObjects() : []), [objects, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const primary = sel.find((o) => o.id === selectedIds[selectedIds.length - 1]);
  if (walk) return null;
  if (!sel.length) return <RoomCard />;
  if (!open) return null;
  return (
    <aside className="inspector glass" aria-label="Inspector">
      {sel.length > 1 ? <MultiSelection objs={sel} /> : primary ? <SelectedObject key={primary.id} obj={primary} /> : null}
    </aside>
  );
}
