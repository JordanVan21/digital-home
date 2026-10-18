import { useCallback, useEffect, useMemo, useRef } from 'react';
import { LocalAssetCatalog, type AssetCatalog } from './catalog/AssetCatalog';
import { LocalScenePersistence } from './persistence/ScenePersistence';
import { floorPointAt, objectIdAt } from './scene/canvasBridge';
import { SceneCanvas } from './scene/SceneCanvas';
import { startAutosave, type Autosave } from './state/autosave';
import { loadSource } from './state/loader';
import { addAsset, toast, useEditor, type SceneSource } from './state/store';
import { ASSET_DRAG_MIME, AssetBrowser } from './ui/AssetBrowser';
import { FloatingToolbar } from './ui/FloatingToolbar';
import { InspectorPanel } from './ui/InspectorPanel';
import { TopBar, type DevActions } from './ui/TopBar';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { BoxSelectRect, ReadyFlag, ReferenceOverlay } from './ui/Overlays';

const SOURCE_KEY = 'house.source';

const isSource = (v: string | null): v is SceneSource => v === 'demo-scan' || v === 'demo-room' || v === 'test2';

function readSource(): SceneSource {
  try {
    const q = new URLSearchParams(location.search).get('source');
    if (isSource(q)) return q;
    const saved = localStorage.getItem(SOURCE_KEY);
    return isSource(saved) ? saved : 'demo-room';
  } catch {
    return 'demo-room';
  }
}

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

function ConflictBanner({ onReload }: { onReload: () => void }) {
  const save = useEditor((s) => s.save);
  if (save.status !== 'conflict') return null;
  return (
    <div className="banner panel" role="alert">
      <div>
        <strong>This room changed somewhere else.</strong> Your edits are kept here and nothing was overwritten.
      </div>
      <button className="btn" onClick={onReload}>Load latest (discard my {save.pending.length} change{save.pending.length === 1 ? '' : 's'})</button>
    </div>
  );
}

export function App() {
  useKeyboardShortcuts();
  const hideUi = useEditor((s) => s.hideUi);
  useEffect(() => {
    // ?hideUi (capture), ?walls=fade|full|cutaway
    const walls = params.get('walls');
    useEditor.setState({
      hideUi: params.has('hideUi'),
      ...(walls === 'fade' || walls === 'full' || walls === 'cutaway' ? { wallMode: walls } : {}),
    });
  }, []);
  const loadError = useEditor((s) => s.loadError);
  const hasScene = useEditor((s) => !!s.workingScene);
  const persistence = useMemo(() => new LocalScenePersistence(), []);
  const catalogRef = useRef<AssetCatalog | null>(null);
  const autosave = useRef<Autosave | null>(null);

  const load = useCallback(async (source: SceneSource) => {
    try {
      catalogRef.current ??= await LocalAssetCatalog.load();
      autosave.current?.reset();
      await loadSource(source, catalogRef.current, persistence);
      try { localStorage.setItem(SOURCE_KEY, source); } catch { /* ignore */ }
    } catch (e) {
      useEditor.setState({ loadError: e instanceof Error ? e.message : String(e) });
    }
  }, [persistence]);

  useEffect(() => {
    autosave.current = startAutosave(persistence);
    void load(readSource());
    return () => autosave.current?.stop();
  }, [persistence, load]);

  const actions: DevActions = {
    retrySave: () => autosave.current?.retry(),
    failNextSave: () => { persistence.failNext(1); toast('The next save will fail (simulated).'); },
    simulateConflict: () => {
      const roomId = useEditor.getState().workingScene?.roomId;
      if (roomId) { persistence.simulateExternalEdit(roomId); toast('Another session saved this room (simulated). Edit something to see the conflict.'); }
    },
    resetRoom: () => {
      const roomId = useEditor.getState().workingScene?.roomId;
      if (roomId) persistence.reset(roomId);
      void load(useEditor.getState().source);
    },
    loadSource: (s) => {
      const { save } = useEditor.getState();
      if (save.pending.length && save.status !== 'saved') {
        toast('Saving your changes first…');
        void autosave.current?.flushNow().then(() => load(s));
        return;
      }
      void load(s);
    },
  };

  const onDrop = (e: React.DragEvent) => {
    const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!assetId) return;
    e.preventDefault();
    const point = floorPointAt(e.clientX, e.clientY);
    if (!point) return toast('Drop the item onto the floor.', 'warning');
    addAsset(assetId, point, objectIdAt(e.clientX, e.clientY));
  };

  return (
    <div className="app">
      <div
        className="canvas-wrap"
        onDragOver={(e) => { if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={onDrop}
      >
        <SceneCanvas />
      </div>
      <ReadyFlag />
      <ReferenceOverlay />
      <BoxSelectRect />
      {!hideUi && (
        <>
          <TopBar actions={actions} />
          <FloatingToolbar />
          <AssetBrowser />
          <InspectorPanel />
        </>
      )}
      <ConflictBanner onReload={() => {
        const roomId = useEditor.getState().workingScene?.roomId;
        autosave.current?.reset();
        if (roomId) void load(useEditor.getState().source);
      }} />
      <Toasts />
      {!hasScene && !loadError && <div className="center-msg">Loading room…</div>}
      {loadError && <div className="center-msg error">Couldn't load the room: {loadError}</div>}
    </div>
  );
}
