import { Boxes, Eye, Footprints, Layers, Scan, Sun } from 'lucide-react';
import { frameCamera, requestCamera, setSceneSettings, toast, useEditor, type WallMode } from '../state/store';
import { Button } from './Button';
import { PRESET_ORDER, THEMES, useLightingPreset } from './theme';

const WALL_ORDER: WallMode[] = ['cutaway', 'fade', 'full'];
const WALL_LABEL: Record<WallMode, string> = { cutaway: 'Cut away', fade: 'Fade', full: 'Show' };

/** Round view buttons on the right edge: lighting, walls, camera views and walk mode. */
export function ViewControls() {
  const preset = useLightingPreset();
  const wallMode = useEditor((s) => s.wallMode);
  const walk = useEditor((s) => s.walkMode);
  const colliders = useEditor((s) => s.showColliders);
  const nextPreset = PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length]!;
  const nextWalls = WALL_ORDER[(WALL_ORDER.indexOf(wallMode) + 1) % WALL_ORDER.length]!;
  return (
    <div className="view-controls" aria-label="View">
      <Button
        label={`Lighting: ${THEMES[preset].label} (click for ${THEMES[nextPreset].label})`}
        className="round glass glass-button"
        onClick={() => { setSceneSettings({ lightingPreset: nextPreset }); toast(`Lighting: ${THEMES[nextPreset].label}`); }}
      >
        <Sun size={19} />
      </Button>
      <Button
        label={`Walls nearest the camera: ${WALL_LABEL[wallMode]} (click for ${WALL_LABEL[nextWalls]})`}
        className="round glass glass-button"
        active={wallMode !== 'cutaway'}
        onClick={() => { useEditor.setState({ wallMode: nextWalls }); toast(`Walls: ${WALL_LABEL[nextWalls]}`); }}
      >
        <Layers size={18} />
      </Button>
      <span className="rule" />
      <Button label="2D plan (top view)" className="round glass glass-button text-icon" onClick={() => requestCamera('top')}>
        2D
      </Button>
      <Button label="3D view" className="round glass glass-button text-icon" onClick={() => requestCamera('iso')}>
        3D
      </Button>
      <Button label="Eye-level view" className="round glass glass-button" onClick={() => requestCamera('eye')}>
        <Eye size={18} />
      </Button>
      <Button label="Fit room in view (Home)" className="round glass glass-button" onClick={() => frameCamera('room')}>
        <Scan size={18} />
      </Button>
      <span className="rule" />
      <Button
        label="Collision shapes"
        className="round glass glass-button"
        active={colliders}
        aria-pressed={colliders}
        onClick={() => useEditor.setState({ showColliders: !colliders })}
      >
        <Boxes size={18} />
      </Button>
      <Button
        label={walk ? 'Exit walk mode (P)' : 'Walk through the room (P)'}
        className="round glass glass-button"
        active={walk}
        aria-pressed={walk}
        onClick={() => useEditor.setState({ walkMode: !walk, selectedIds: [], selectedId: null })}
      >
        <Footprints size={18} />
      </Button>
    </div>
  );
}
